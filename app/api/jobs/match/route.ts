import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/session";
import { errorResponse } from "@/lib/api-response";
import { runMatchSelected } from "@/lib/jobs/match";
import { matchSelectedSchema } from "@/lib/schemas/jobs";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await requireApiSession();
  if (!session) return errorResponse("Não autenticado.", 401);

  try {
    const body = await request.json().catch(() => null);
    const parsed = matchSelectedSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        parsed.error.issues[0]?.message ?? "Payload inválido.",
        400
      );
    }

    const result = await runMatchSelected(
      session.user.id,
      parsed.data.applicationIds
    );
    return NextResponse.json(result);
  } catch (error) {
    console.error("job match failed", error);
    const message =
      error instanceof Error ? error.message : "Erro ao dar match.";
    return errorResponse(message, 500);
  }
}
