import { prisma } from "@/lib/prisma";

export type MatchSelectedResult = {
  updated: number;
  message: string;
};

/**
 * Marks selected applications as MATCHED (manual shortlist).
 * Only FOUND or QUEUED statuses are updated.
 */
export async function runMatchSelected(
  userId: string,
  applicationIds: string[]
): Promise<MatchSelectedResult> {
  if (applicationIds.length === 0) {
    throw new Error("Selecione ao menos uma vaga.");
  }

  const result = await prisma.application.updateMany({
    where: {
      userId,
      id: { in: applicationIds },
      status: { in: ["FOUND", "QUEUED"] },
    },
    data: { status: "MATCHED", errorMessage: null },
  });

  return {
    updated: result.count,
    message:
      result.count === 0
        ? "Nenhuma vaga elegível para match (status deve ser Encontrada ou Na fila)."
        : result.count === 1
          ? "1 vaga marcada como match."
          : `${result.count} vagas marcadas como match.`,
  };
}
