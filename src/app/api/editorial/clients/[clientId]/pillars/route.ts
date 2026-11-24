import { isPgUniqueViolation, jsonError, readJsonBody, requireApiAuth, requireClient } from "@/lib/editorial-api";
import { createPillar, listPillars } from "@/lib/editorial-queries";
import { HEX_COLOR_RE, summarizePillarWeights } from "@/lib/editorial-rules";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ clientId: string }> }): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;
  const { clientId } = await ctx.params;
  const clientData = await requireClient(clientId);
  if (!clientData) return jsonError("Cliente não encontrado.", 404);

  const archived = new URL(req.url).searchParams.get("archived") === "1";
  const pillars = await listPillars(clientId, { includeArchived: archived });
  const { total } = summarizePillarWeights(pillars.filter((p) => !p.archived_at).map((p) => p.weight_pct));
  return Response.json({ pillars, total_weight_pct: total });
}

export async function POST(req: Request, ctx: { params: Promise<{ clientId: string }> }): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;
  const { clientId } = await ctx.params;
  const clientData = await requireClient(clientId);
  if (!clientData) return jsonError("Cliente não encontrado.", 404);

  const body = await readJsonBody<{
    name?: string;
    description?: string;
    color?: string;
    weight_pct?: number;
    weekly_target?: number | null;
    position?: number;
  }>(req);
  if (!body) return jsonError("Corpo da requisição inválido.", 400);

  const name = String(body.name ?? "").trim();
  if (name.length < 1 || name.length > 80) return jsonError("Informe um nome entre 1 e 80 caracteres.", 400);
  const color = body.color ? String(body.color).trim() : "#596579";
  if (!HEX_COLOR_RE.test(color)) return jsonError("Cor inválida (use hexadecimal #RRGGBB).", 400);

  const weight = body.weight_pct ?? 0;
  if (!Number.isInteger(weight) || weight < 0 || weight > 100) {
    return jsonError("O peso percentual deve ser um número inteiro entre 0 e 100.", 400);
  }
  const wt = body.weekly_target;
  if (wt !== undefined && wt !== null && (!Number.isInteger(wt) || wt < 0 || wt > 21)) {
    return jsonError("A meta semanal deve estar entre 0 e 21.", 400);
  }

  try {
    const pillar = await createPillar(clientId, {
      name,
      description: String(body.description ?? ""),
      color,
      weight_pct: weight,
      weekly_target: wt ?? null,
      position: Number.isInteger(body.position) ? body.position : 0,
    });
    return Response.json({ pillar }, { status: 201 });
  } catch (e) {
    if (isPgUniqueViolation(e)) return jsonError("Já existe um pilar com este nome neste cliente.", 409);
    throw e;
  }
}
