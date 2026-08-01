import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/session";
import { errorResponse } from "@/lib/api-response";
import { clearDemoJobsForUser } from "@/lib/jobs/clear-demo";

export async function DELETE() {
  const session = await requireApiSession();
  if (!session) return errorResponse("Não autenticado.", 401);

  try {
    const result = await clearDemoJobsForUser(session.user.id);
    return NextResponse.json({
      ...result,
      message:
        result.deletedApplications === 0 && result.deletedJobs === 0
          ? "Nenhuma vaga demo para limpar."
          : `Removidas ${result.deletedApplications} candidatura(s) demo e ${result.deletedJobs} vaga(s).`,
    });
  } catch (error) {
    console.error("clear demo jobs failed", error);
    return errorResponse("Erro ao limpar vagas demo.", 500);
  }
}
