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

    const result = await runJobSearch(session.user.id);
    let message = `Encontramos ${result.created} vaga(s) com match (≥${result.minMatchScore}%) de ${result.searchTarget} pedidas (${(result.sourcesUsed ?? [result.source]).join(", ")}).`;
    if (result.created < result.searchTarget && result.pagesExhausted) {
      message +=
        " Não há mais resultados nas páginas seguintes com o filtro atual.";
    }
    if (result.skippedMinMatch > 0) {
      message += ` ${result.skippedMinMatch} vaga(s) ficaram abaixo do match mínimo.`;
    }
    if (result.alreadyHad > 0) {
      message += ` ${result.alreadyHad} já estavam na sua lista.`;
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
