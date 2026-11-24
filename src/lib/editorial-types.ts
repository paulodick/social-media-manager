import type { MediaMeta } from "./checks.ts";

export type Pillar = {
  id: string;
  client_id: string;
  name: string;
  description: string;
  color: string;
  weight_pct: number;
  weekly_target: number | null;
  position: number;
  archived_at: string | null;
};

export type ContentSourceKind = "existing_ready" | "needs_creation";
export type ContentFormat = "video" | "carousel" | "static_image";
export type PlanStatus = "draft" | "approved";
export type ContentStatus = "idea" | "drafting" | "ready" | "archived";
export type AssetKind = "carousel" | "static";
export type AssetAspect = "4:5" | "1:1" | "9:16" | "16:9";
export type AssetStatus = "draft" | "ready" | "approved";

export type SlideInput = {
  /** Ausente = slide novo. A posição é a ordem do array enviado. */
  id?: string;
  headline: string;
  body: string;
  cta: string;
  visual_notes: string;
  extra?: Record<string, string>;
  source?: "manual" | "ai";
};

export type Slide = {
  id: string;
  position: number;
  headline: string;
  body: string;
  cta: string;
  visual_notes: string;
  extra: Record<string, string>;
  source: "manual" | "ai";
  drive_url: string;
  drive_file_id: string | null;
  drive_meta: MediaMeta | null;
};

export type VisualAsset = {
  id: string;
  client_id: string;
  content_item_id: string;
  kind: AssetKind;
  title: string;
  aspect: AssetAspect;
  status: AssetStatus;
  generation_prompt: string;
  drive_folder_id: string | null;
  position: number;
  slides: Slide[];
};

export type ContentItem = {
  id: string;
  client_id: string;
  pillar_id: string | null;
  source_kind: ContentSourceKind;
  content_format: ContentFormat;
  title: string;
  theme_key: string;
  guest_name: string;
  topic_tag: string;
  cover_idea: string;
  cover_drive_file_id: string | null;
  cover_drive_url: string;
  doc_drive_file_id: string | null;
  source_folder_id: string | null;
  source_folder_name: string;
  hook: string;
  angle: string;
  brief: string;
  script: string;
  script_hook: string;
  script_dev: string;
  script_cta: string;
  transcript: string;
  caption_draft: string;
  caption_instagram: string;
  caption_linkedin: string;
  tones: string[];
  status: ContentStatus;
  drive_url: string;
  drive_file_id: string | null;
  drive_meta: MediaMeta | null;
  created_at: string;
  updated_at: string;
};

export type ItemCard = ContentItem & {
  pillar: Pick<Pillar, "id" | "name" | "color"> | null;
  assets_count: number;
  slots_count: number;
  in_queue_count: number;
};

export type SlotView = {
  id: string;
  client_id: string;
  content_item_id: string;
  asset_id: string | null;
  day: string;
  time: string | null;
  position: number;
  network: string;
  format: string;
  status: "planned" | "skipped";
  plan_status: PlanStatus;
  approved_at: string | null;
  item: {
    title: string;
    source_kind: ContentSourceKind;
    content_format: ContentFormat;
    status: ContentStatus;
    pillar_id: string | null;
    pillar_name: string | null;
    pillar_color: string | null;
    guest_name: string;
    topic_tag: string;
    cover_idea: string;
    caption_draft: string;
    caption_instagram: string;
    caption_linkedin: string;
    script_hook: string;
    script_dev: string;
    script_cta: string;
  };
  asset: { id: string; kind: AssetKind; title: string } | null;
  /** Destino real na fila de publicação (null = ainda só planejado). */
  target: {
    id: string;
    status: "draft" | "scheduled" | "posted";
    publish_state: string;
    auto_confirmed: boolean;
  } | null;
  late: boolean;
};

export type AiClassificationEntry = {
  item_id: string;
  pillar_id: string | null;
  title: string;
  theme_key: string;
  guest_name?: string;
  topic_tag?: string;
  cover_idea?: string;
  caption_instagram?: string;
  caption_linkedin?: string;
  caption_draft?: string;
  brief: string;
  hook: string;
  confidence: number;
};

export type AiCalendarNewItem = {
  title: string;
  content_format: ContentFormat;
  theme_key: string;
  hook: string;
  angle: string;
  brief: string;
  script: string;
  script_hook: string;
  script_dev: string;
  script_cta: string;
  caption_draft: string;
  tones: string[];
};

export type AiCalendarEntry = {
  planned_day: string;
  planned_time: string | null;
  network: string;
  format: string;
  source_kind: ContentSourceKind;
  existing_item_id: string | null;
  pillar_id: string;
  new_item: AiCalendarNewItem | null;
};

export const CAROUSEL_MIN_SLIDES = 2;
/** Ajustável: confirmar o limite oficial de cada rede antes de usar numa checagem (regra do projeto: limite null = desligado). */
export const CAROUSEL_MAX_SLIDES = 10;
