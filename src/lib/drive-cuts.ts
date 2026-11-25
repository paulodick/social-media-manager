import { inflateRawSync } from "node:zlib";
import type { ListedFile } from "./drive.ts";

export type DriveCutBundle = {
  folder_id: string;
  folder_name: string;
  video: ListedFile | null;
  cover: ListedFile | null;
  doc: ListedFile | null;
  extra_files: ListedFile[];
  skip_video_transcription: boolean;
  detected_guest: string;
  detected_topic: string;
};

export type DocExtractionResult = {
  text: string;
  format: "google_doc" | "docx" | "rtf" | "plain" | "doc_binary" | "fallback";
  warning?: string;
};

export type ParsedCutDocument = {
  title: string;
  guest_name: string;
  topic_tag: string;
  cover_idea: string;
  hook: string;
  brief: string;
  caption_draft: string;
  caption_instagram: string;
  caption_linkedin: string;
  used_video_transcription: false;
};

const DOC_MIMES = new Set([
  "application/vnd.google-apps.document",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
  "application/rtf",
  "text/rtf",
]);

const DOC_EXT_RE = /\.(docx?|txt|md|rtf)$/i;
const VIDEO_EXT_RE = /\.(mp4|mov|m4v|webm|mkv|avi)$/i;
const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|heic)$/i;
const COVER_HINT_RE = /(capa|thumb|cover|miniatura)/i;
const DOC_HINT_RE = /(legenda|copy|texto|roteiro|corte|descricao|descrição)/i;
// "Reels Editados" é lida à parte (vídeos prontos da sequência), por isso não vira um corte avulso.
const IGNORED_FOLDER_RE = /^(logotipo|logos?|artes|20\d{2}|reels[\s_-]*editados)$/i;

export function isDocFile(file: { name: string; mimeType: string }): boolean {
  return DOC_MIMES.has(file.mimeType) || DOC_EXT_RE.test(file.name);
}

export function isVideoFile(file: { name: string; mimeType: string }): boolean {
  return file.mimeType.startsWith("video/") || VIDEO_EXT_RE.test(file.name);
}

export function isImageFile(file: { name: string; mimeType: string }): boolean {
  return file.mimeType.startsWith("image/") || IMAGE_EXT_RE.test(file.name);
}

export function isIgnoredCutFolderName(name: string): boolean {
  return IGNORED_FOLDER_RE.test(name.trim());
}

/**
 * Extrai convidado e assunto heurísticos a partir do nome da pasta de corte.
 * Exemplos:
 * - "01 - Prof. Lucio Flavio - IA na Medicina" -> guest: "Prof. Lucio Flavio", topic: "IA na Medicina"
 * - "Corte 03 - Leonardo Milner - Gestão de Clínicas" -> guest: "Leonardo Milner", topic: "Gestão de Clínicas"
 * - "Corte 05 - Dr. Phillip Dmitruk" -> guest: "Dr. Phillip Dmitruk", topic: ""
 */
export function inferGuestAndTopicFromFolderName(folderName: string): { guest: string; topic: string } {
  const cleaned = folderName.trim().replace(/\s+/g, " ");
  if (!cleaned) return { guest: "", topic: "" };

  const parts = cleaned
    .split(/\s*(?:[-–—|]|\s+-\s+)\s*/)
    .map((p) => p.trim())
    .filter(Boolean);

  // Remove prefixo numérico ou "Corte 01", "Ep 12", "EP04", "Clip 2"
  const filtered = parts.filter((p, idx) => {
    if (idx === 0 && /^(?:corte|clip|ep(?:isodio|isódio)?|#)?\s*\d+[a-z]?$/i.test(p)) {
      return false;
    }
    return true;
  });

  if (filtered.length >= 2) {
    return { guest: filtered[0].slice(0, 120), topic: filtered.slice(1).join(" - ").slice(0, 120) };
  }
  if (filtered.length === 1) {
    // Se tiver título honorífico (Dr., Dra., Prof., etc.), provavelmente é convidado
    if (/^(?:dr\.?|dra\.?|prof\.?|profa\.?)\s+/i.test(filtered[0])) {
      return { guest: filtered[0].slice(0, 120), topic: "" };
    }
    return { guest: "", topic: filtered[0].slice(0, 120) };
  }
  return { guest: "", topic: "" };
}

/**
 * Agrupa os arquivos de uma subpasta de corte (vídeo + capa + .doc) em um único bundle editorial.
 * Retorna null se a subpasta não tiver vídeo, capa nem documento.
 */
export function groupFolderIntoCutBundle(
  folder: { id: string; name: string },
  files: ListedFile[],
): DriveCutBundle | null {
  const videos = files.filter(isVideoFile);
  const images = files.filter(isImageFile);
  const docs = files.filter(isDocFile);

  if (!videos.length && !images.length && !docs.length) return null;

  // Vídeo principal: prefere o maior (quando houver size), senão o primeiro.
  const video =
    videos.length > 0
      ? [...videos].sort((a, b) => (b.size ?? 0) - (a.size ?? 0))[0]
      : null;

  // Capa: prefere imagem com hint de capa/thumb no nome, senão a primeira imagem.
  const cover =
    images.find((f) => COVER_HINT_RE.test(f.name)) ?? images[0] ?? null;

  // Documento: prefere .doc/.docx/Google Doc com hint de legenda/copy, senão o primeiro documento.
  const doc =
    docs.find((f) => DOC_HINT_RE.test(f.name)) ?? docs[0] ?? null;

  const pickedIds = new Set([video?.id, cover?.id, doc?.id].filter((x): x is string => !!x));
  const extra_files = files.filter((f) => !pickedIds.has(f.id));
  const inferred = inferGuestAndTopicFromFolderName(folder.name);

  return {
    folder_id: folder.id,
    folder_name: folder.name,
    video,
    cover,
    doc,
    extra_files,
    // Nunca envia vídeo completo para transcrição pesada por padrão.
    skip_video_transcription: true,
    detected_guest: inferred.guest,
    detected_topic: inferred.topic,
  };
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/** Extrai word/document.xml de um buffer ZIP (.docx) sem dependências externas. */
function extractDocxXml(buf: Buffer): string | null {
  // Percorre entradas do diretório central (PK\x01\x02) ou cabeçalhos locais (PK\x03\x04)
  let offset = 0;
  while (offset + 30 <= buf.length) {
    const sig = buf.readUInt32LE(offset);
    if (sig !== 0x04034b50) {
      // Tenta localizar próximo cabeçalho local
      const next = buf.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), offset + 1);
      if (next === -1) break;
      offset = next;
      continue;
    }
    const compression = buf.readUInt16LE(offset + 8);
    let compSize = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLen + extraLen;
    if (dataStart > buf.length) break;
    const entryName = buf.subarray(nameStart, nameStart + nameLen).toString("utf8");

    // Se flag bit 3 (data descriptor) estiver setado e compSize == 0, busca próximo PK
    if (compSize === 0) {
      const nextSig = buf.indexOf(Buffer.from([0x50, 0x4b]), dataStart);
      compSize = nextSig === -1 ? buf.length - dataStart : nextSig - dataStart;
    }
    const dataEnd = Math.min(buf.length, dataStart + compSize);
    if (entryName === "word/document.xml") {
      const slice = buf.subarray(dataStart, dataEnd);
      try {
        if (compression === 0) return slice.toString("utf8");
        if (compression === 8) return inflateRawSync(slice).toString("utf8");
      } catch {
        return null;
      }
    }
    offset = dataEnd > offset ? dataEnd : offset + 4;
  }
  return null;
}

function xmlToPlainText(xml: string): string {
  return decodeXmlEntities(
    xml
      .replace(/<w:tab\b[^>]*\/>/g, "\t")
      .replace(/<w:br\b[^>]*\/>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripRtf(raw: string): string {
  return raw
    .replace(/\{\\[^{}]*\}/g, " ")
    .replace(/\\par[d]?/g, "\n")
    .replace(/\\line/g, "\n")
    .replace(/\\'([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\[a-zA-Z]+-?\d* ?/g, "")
    .replace(/[{}]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const OLE_NOISE_RE =
  /^(?:Root Entry|WordDocument|1Table|0Table|SummaryInformation|DocumentSummaryInformation|CompObj|Data|Microsoft|Normal|Times New Roman|Calibri|Arial|Cambria|Default Paragraph Font|Table Normal|No List|Hyperlink)$/i;

function extractBinaryDocText(buf: Buffer): string {
  // Tenta extrair sequências legíveis em UTF-16LE (comum em Word 97-2003 .doc)
  const utf16Chunks: string[] = [];
  let cur = "";
  for (let i = 0; i + 1 < buf.length; i += 2) {
    const code = buf.readUInt16LE(i);
    const printable =
      code === 10 ||
      code === 13 ||
      code === 9 ||
      (code >= 32 && code <= 126) ||
      (code >= 160 && code <= 255) ||
      code === 0x2013 ||
      code === 0x2014 ||
      code === 0x201c ||
      code === 0x201d ||
      code === 0x2019;
    if (printable) {
      cur += code === 13 ? "\n" : String.fromCharCode(code);
    } else {
      const t = cur.trim();
      if (t.length >= 6 && !OLE_NOISE_RE.test(t) && /[a-zA-ZÀ-ÿ]{3,}/.test(t)) {
        utf16Chunks.push(t);
      }
      cur = "";
    }
  }
  if (cur.trim().length >= 6 && !OLE_NOISE_RE.test(cur.trim())) {
    utf16Chunks.push(cur.trim());
  }

  if (utf16Chunks.length > 0) {
    const joined = utf16Chunks.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    if (joined.length >= 12) return joined;
  }

  // Fallback: sequências Latin-1 legíveis
  const latin = buf.toString("latin1");
  const matches = latin.match(/[A-Za-zÀ-ÿ0-9.,;:!?()[\]"'/%#@\-–— \t\r\n]{12,}/g) ?? [];
  const filtered = matches
    .map((m) => m.replace(/\r/g, "\n").trim())
    .filter((m) => m.length >= 12 && !OLE_NOISE_RE.test(m) && /[A-Za-zÀ-ÿ]{3,}/.test(m));
  return filtered.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Extrai texto de um buffer de arquivo `.doc`, `.docx`, `.rtf` ou texto puro com fallback seguro.
 * Nunca lança exceção em arquivos corrompidos ou binários desconhecidos.
 */
export function extractTextFromDocBuffer(buf: Buffer, fileName = ""): DocExtractionResult {
  if (!buf || buf.length === 0) {
    return {
      text: "",
      format: "fallback",
      warning: "Arquivo de documento vazio; usando nome da pasta como referência.",
    };
  }

  // 1) ZIP / .docx (PK\x03\x04)
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    const xml = extractDocxXml(buf);
    if (xml) {
      const text = xmlToPlainText(xml);
      if (text) return { text, format: "docx" };
    }
  }

  // 2) RTF
  const head = buf.subarray(0, Math.min(buf.length, 32)).toString("latin1");
  if (head.startsWith("{\\rtf")) {
    const text = stripRtf(buf.toString("latin1"));
    if (text) return { text, format: "rtf" };
  }

  // 3) Texto puro UTF-8 (sem bytes NUL e alta taxa de caracteres legíveis)
  const sample = buf.subarray(0, Math.min(buf.length, 4096));
  const hasNull = sample.includes(0);
  if (!hasNull) {
    const utf8 = buf.toString("utf8").replace(/^\uFEFF/, "").trim();
    let printable = 0;
    for (let i = 0; i < Math.min(utf8.length, 2000); i++) {
      const c = utf8.charCodeAt(i);
      if (c === 9 || c === 10 || c === 13 || (c >= 32 && c !== 127)) printable++;
    }
    const ratio = utf8.length > 0 ? printable / Math.min(utf8.length, 2000) : 0;
    if (utf8.length > 0 && ratio >= 0.85) {
      return { text: utf8.replace(/\r\n/g, "\n"), format: "plain" };
    }
  }

  // 4) Binário OLE2 (.doc antigo)
  const extracted = extractBinaryDocText(buf);
  if (extracted) {
    return { text: extracted, format: "doc_binary" };
  }

  return {
    text: "",
    format: "fallback",
    warning: `Não foi possível extrair texto legível de "${fileName || "documento"}"; usando nome da pasta e metadados como referência.`,
  };
}

function cleanLineValue(s: string): string {
  return s.replace(/^[\s:\-–—]+/, "").trim();
}

/**
 * Interpreta o texto extraído de um `.doc` de corte (com fallback para nome da pasta/capa)
 * extraindo convidado, assunto/tag, ideia de capa, gancho e legendas separadas para Instagram e LinkedIn.
 */
export function parseCutDocument(input: {
  folderName: string;
  videoName?: string;
  coverName?: string;
  docText: string;
}): ParsedCutDocument {
  const raw = input.docText.replace(/\r\n/g, "\n").trim();
  const lines = raw.split("\n");
  const inferred = inferGuestAndTopicFromFolderName(input.folderName);

  let title = "";
  let guest = "";
  let topic = "";
  let coverIdea = "";
  let hook = "";

  type Section = "none" | "instagram" | "linkedin" | "caption" | "cover";
  let section: Section = "none";
  const igLines: string[] = [];
  const liLines: string[] = [];
  const generalCaptionLines: string[] = [];
  const coverLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Detecta cabeçalhos de seção de legenda por rede
    const igMatch = line.match(/^(?:legenda\s*(?:para\s*)?(?:instagram|ig|reels)|instagram|ig)\s*[:\-–—]?\s*(.*)$/i);
    if (igMatch && (line.includes(":") || /^(?:legenda\s*(?:para\s*)?(?:instagram|ig|reels)|instagram|ig)$/i.test(line))) {
      section = "instagram";
      if (igMatch[1]?.trim()) igLines.push(igMatch[1].trim());
      continue;
    }

    const liMatch = line.match(/^(?:legenda\s*(?:para\s*)?(?:linkedin|li)|linkedin)\s*[:\-–—]?\s*(.*)$/i);
    if (liMatch && (line.includes(":") || /^(?:legenda\s*(?:para\s*)?(?:linkedin|li)|linkedin)$/i.test(line))) {
      section = "linkedin";
      if (liMatch[1]?.trim()) liLines.push(liMatch[1].trim());
      continue;
    }

    const capMatch = line.match(/^(?:legenda(?:\s+base|\s+sugerida)?|copy)\s*[:\-–—]\s*(.*)$/i);
    if (capMatch) {
      section = "caption";
      if (capMatch[1]?.trim()) generalCaptionLines.push(capMatch[1].trim());
      continue;
    }

    // Detecta campos de metadados de uma linha
    const guestMatch = line.match(/^(?:convidad[oa]|participante|palestrante|entrevistad[oa]|guest|speaker)\s*[:\-–—]\s*(.+)$/i);
    if (guestMatch) {
      guest = cleanLineValue(guestMatch[1]).slice(0, 120);
      section = "none";
      continue;
    }

    const topicMatch = line.match(/^(?:assunto|tema|tag|t[oó]pico|pauta)\s*[:\-–—]\s*(.+)$/i);
    if (topicMatch) {
      topic = cleanLineValue(topicMatch[1]).slice(0, 120);
      section = "none";
      continue;
    }

    const titleMatch = line.match(/^(?:t[ií]tulo(?:\s+do\s+corte)?|nome(?:\s+do\s+corte)?)\s*[:\-–—]\s*(.+)$/i);
    if (titleMatch) {
      title = cleanLineValue(titleMatch[1]).slice(0, 160);
      section = "none";
      continue;
    }

    const coverMatch = line.match(/^(?:ideia\s+de\s+capa|texto\s+da\s+capa|capa|thumb(?:nail)?)\s*[:\-–—]\s*(.*)$/i);
    if (coverMatch) {
      section = "cover";
      if (coverMatch[1]?.trim()) coverLines.push(cleanLineValue(coverMatch[1]));
      continue;
    }

    const hookMatch = line.match(/^(?:gancho|hook|abertura)\s*[:\-–—]\s*(.+)$/i);
    if (hookMatch) {
      hook = cleanLineValue(hookMatch[1]).slice(0, 240);
      section = "none";
      continue;
    }

    // Acumula linhas dentro da seção ativa
    if (section === "instagram") {
      igLines.push(rawLine.trimEnd());
    } else if (section === "linkedin") {
      liLines.push(rawLine.trimEnd());
    } else if (section === "caption") {
      generalCaptionLines.push(rawLine.trimEnd());
    } else if (section === "cover") {
      if (line) coverLines.push(line);
      else section = "none";
    }
  }

  const captionInstagram = igLines.join("\n").trim().slice(0, 4000);
  const captionLinkedin = liLines.join("\n").trim().slice(0, 4000);
  const generalCaption = generalCaptionLines.join("\n").trim().slice(0, 4000);

  if (coverLines.length) {
    coverIdea = coverLines.join(" ").trim().slice(0, 300);
  }
  if (!coverIdea && input.coverName) {
    coverIdea = `Referência de capa: ${input.coverName.replace(/\.[^.]+$/, "")}`.slice(0, 300);
  }

  const finalGuest = guest || inferred.guest;
  const finalTopic = topic || inferred.topic;

  const fallbackTitle =
    input.folderName.trim() ||
    input.videoName?.replace(/\.[^.]+$/, "").trim() ||
    "Corte do Drive";
  const finalTitle = (title || fallbackTitle).slice(0, 160);

  const captionDraft = (
    generalCaption ||
    captionInstagram ||
    captionLinkedin ||
    (raw.length > 0 && !title && !guest && !topic ? raw : "")
  ).slice(0, 4000);

  const firstCaptionLine = (captionInstagram || captionDraft || captionLinkedin)
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length >= 8);

  const finalHook = (hook || firstCaptionLine || "").slice(0, 240);

  const briefParts: string[] = [];
  if (finalGuest) briefParts.push(`Convidado: ${finalGuest}`);
  if (finalTopic) briefParts.push(`Assunto: ${finalTopic}`);
  if (coverIdea) briefParts.push(`Capa: ${coverIdea}`);
  if (raw) {
    briefParts.push(raw.slice(0, 1100));
  } else {
    briefParts.push(`Corte importado da pasta "${input.folderName}".`);
  }

  return {
    title: finalTitle,
    guest_name: finalGuest,
    topic_tag: finalTopic,
    cover_idea: coverIdea,
    hook: finalHook,
    brief: briefParts.join("\n").slice(0, 1500),
    caption_draft: captionDraft,
    caption_instagram: captionInstagram,
    caption_linkedin: captionLinkedin,
    used_video_transcription: false,
  };
}
