import { isPgUniqueViolation, jsonError, readJsonBody, requireApiAuth, requireClient } from "@/lib/editorial-api";
import { createPillar, listPillars } from "@/lib/editorial-queries";
import { extractJsonPayload, parsePillarsInput } from "@/lib/editorial-rules";
import type { Pillar } from "@/lib/editorial-types";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ clientId: string }> }): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;
  const { clientId } = await ctx.params;
  const clientData = await requireClient(clientId);
  if (!clientData) return jsonError("Cliente não encontrado.", 404);

  const body = await readJsonBody<{ pillars?: unknown; json?: string }>(req);
  if (!body) return jsonError("Corpo da requisição inválido.", 400);

  let rawInput: unknown = body.pillars;
  if (rawInput === undefined && typeof body.json === "string") {
    try {
      rawInput = extractJsonPayload(body.json);
    } catch {
      return jsonError("O JSON informado não é válido.", 400);
    }
  }

  const parsed = parsePillarsInput(rawInput);
  if (!parsed.ok) return jsonError(parsed.error, 400);

  const existing = await listPillars(clientId);
  let nextPos = existing.length;
  const created: Pillar[] = [];
  const skippedDuplicates: string[] = [];

  for (const p of parsed.pillars) {
    try {
      const row = await createPillar(clientId, {
        name: p.name,
        description: p.description,
        color: p.color,
        weight_pct: p.weight_pct,
        weekly_target: p.weekly_target,
        position: nextPos++,
      });
      created.push(row);
    } catch (e) {
      if (isPgUniqueViolation(e)) {
        skippedDuplicates.push(p.name);
      } else {
        throw e;
      }
    }
  }

  return Response.json({ created, skipped_duplicates: skippedDuplicates }, { status: 201 });
}
