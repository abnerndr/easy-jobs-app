import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/session";
import { errorResponse } from "@/lib/api-response";
import { runApplySelected } from "@/lib/jobs/apply";
import { applySelectedSchema } from "@/lib/schemas/jobs";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await requireApiSession();
  if (!session) return errorResponse("Não autenticado.", 401);

  try {
    const body = await request.json().catch(() => null);
    const parsed = applySelectedSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        parsed.error.issues[0]?.message ?? "Payload inválido.",
        400
      );
    }

    const result = await runApplySelected(
      session.user.id,
      parsed.data.applicationIds
    );
    return NextResponse.json(result);
  } catch (error) {
    console.error("job apply failed", error);
    const message =
      error instanceof Error ? error.message : "Erro ao candidatar.";
    return errorResponse(message, 500);
  }
}
