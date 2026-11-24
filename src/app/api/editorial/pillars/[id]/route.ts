import { isPgUniqueViolation, jsonError, readJsonBody, requireApiAuth } from "@/lib/editorial-api";
import { getPillar, updatePillar } from "@/lib/editorial-queries";
import { HEX_COLOR_RE, isUuid } from "@/lib/editorial-rules";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError("Pilar inválido.", 400);

  const existing = await getPillar(id);
  if (!existing) return jsonError("Pilar não encontrado.", 404);

  const body = await readJsonBody<{
    name?: string;
    description?: string;
    color?: string;
    weight_pct?: number;
    weekly_target?: number | null;
    position?: number;
    archived?: boolean;
  }>(req);
  if (!body) return jsonError("Corpo da requisição inválido.", 400);

  if (body.name !== undefined) {
    const n = String(body.name).trim();
    if (n.length < 1 || n.length > 80) return jsonError("Informe um nome entre 1 e 80 caracteres.", 400);
  }
  if (body.color !== undefined && !HEX_COLOR_RE.test(String(body.color).trim())) {
    return jsonError("Cor inválida (use hexadecimal #RRGGBB).", 400);
  }
  if (body.weight_pct !== undefined && (!Number.isInteger(body.weight_pct) || body.weight_pct < 0 || body.weight_pct > 100)) {
    return jsonError("O peso percentual deve ser um número inteiro entre 0 e 100.", 400);
  }
  if (
    body.weekly_target !== undefined &&
    body.weekly_target !== null &&
    (!Number.isInteger(body.weekly_target) || body.weekly_target < 0 || body.weekly_target > 21)
  ) {
    return jsonError("A meta semanal deve estar entre 0 e 21.", 400);
  }

  try {
    const pillar = await updatePillar(id, {
      name: body.name,
      description: body.description,
      color: body.color?.trim(),
      weight_pct: body.weight_pct,
      weekly_target: body.weekly_target,
      position: body.position,
      archived: body.archived,
    });
    return Response.json({ pillar });
  } catch (e) {
    if (isPgUniqueViolation(e)) return jsonError("Já existe um pilar com este nome neste cliente.", 409);
    throw e;
  }
}
