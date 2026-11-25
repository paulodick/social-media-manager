// Rótulos da ficha dos vídeos prontos, sem dependências de servidor (usados também na tela).
export type Audience = "gestor" | "tecnico" | "geral";

export const AUDIENCE_LABEL: Record<Audience, string> = {
  gestor: "Gestores",
  tecnico: "Técnicos",
  geral: "Público geral",
};

export type QualityFlag = "no_transcript" | "uncertain" | "commercial_music" | "no_speech";

export const FLAG_LABEL: Record<QualityFlag, string> = {
  no_transcript: "Sem transcrição",
  uncertain: "Transcrição com trechos incertos: confira de ouvido",
  commercial_music: "Música comercial: pode limitar o alcance",
  no_speech: "Sem fala (só texto na tela)",
};
