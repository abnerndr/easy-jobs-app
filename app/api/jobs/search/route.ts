import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/session";
import { errorResponse } from "@/lib/api-response";
import { runJobSearch } from "@/lib/jobs/search";
import { prisma } from "@/lib/prisma";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST() {
  const session = await requireApiSession();
  if (!session) return errorResponse("Não autenticado.", 401);

  try {
    const profile = await prisma.profile.findUnique({
      where: { userId: session.user.id },
    });
    if (!profile) {
      return errorResponse("Complete o perfil antes de buscar vagas.", 400);
    }

    // Always sync: job board scrapes need the Node process (Playwright).
    const result = await runJobSearch(session.user.id);
    let message =
      result.created === 0 && result.remainingToday === 0
        ? "Limite diário atingido."
        : `Encontramos ${result.created} vaga(s) reais (${(result.sourcesUsed ?? [result.source]).join(", ")}).`;
    if (result.skippedMinMatch > 0) {
      message += ` ${result.skippedMinMatch} vaga(s) ficaram abaixo do match mínimo (${result.minMatchScore}%).`;
    }
    return NextResponse.json({
      mode: "sync" as const,
      ...result,
      message,
    });
  } catch (error) {
    console.error("job search failed", error);
    const message =
      error instanceof Error ? error.message : "Erro ao buscar vagas.";
    return errorResponse(message, 500);
  }
}
