export const UUID_RE = /^[0-9a-f-]{36}$/i;

export function isValidUuid(id: string): boolean {
  return UUID_RE.test(id);
}

export function canMarkPosted(publishState: string): { ok: true } | { ok: false; error: string } {
  if (publishState === "publishing") {
    return { ok: false, error: "Este destino está sendo publicado agora. Aguarde concluir." };
  }
  return { ok: true };
}

export function isUndoableStatus(status: string): status is "draft" | "scheduled" {
  return status === "draft" || status === "scheduled";
}
