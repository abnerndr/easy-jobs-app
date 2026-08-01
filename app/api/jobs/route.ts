import { NextResponse } from "next/server";
import * as z from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiSession } from "@/lib/session";
import { errorResponse, validationErrorResponse } from "@/lib/api-response";

const deleteSelectedSchema = z.object({
  applicationIds: z
    .array(z.string().min(1))
    .min(1, { error: "Selecione ao menos uma vaga." }),
});

export async function GET() {
  const session = await requireApiSession();
  if (!session) return errorResponse("Não autenticado.", 401);

  try {
    const applications = await prisma.application.findMany({
      where: { userId: session.user.id },
      orderBy: [{ matchScore: "desc" }, { createdAt: "desc" }],
      take: 100,
      include: {
        job: true,
      },
    });

    const jobs = applications.map((app) => ({
      applicationId: app.id,
      status: app.status,
      matchScore: app.matchScore,
      createdAt: app.createdAt,
      job: {
        id: app.job.id,
        title: app.job.title,
        company: app.job.company,
        location: app.job.location,
        url: app.job.url,
        source: app.job.source,
        workMode: app.job.workMode,
        description: app.job.description,
      },
    }));

    return NextResponse.json({ jobs });
  } catch (error) {
    console.error("jobs list failed", error);
    return errorResponse("Erro ao listar vagas.", 500);
  }
}

export async function DELETE(request: Request) {
  const session = await requireApiSession();
  if (!session) return errorResponse("Não autenticado.", 401);

  const body = await request.json().catch(() => null);
  if (!body) return errorResponse("Corpo da requisição inválido.", 400);

  const parsed = deleteSelectedSchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  try {
    const owned = await prisma.application.findMany({
      where: {
        userId: session.user.id,
        id: { in: parsed.data.applicationIds },
      },
      select: { id: true, jobId: true },
    });

    if (owned.length === 0) {
      return NextResponse.json({
        deletedApplications: 0,
        deletedJobs: 0,
        message: "Nenhuma vaga selecionada encontrada.",
      });
    }

    const jobIds = [...new Set(owned.map((row) => row.jobId))];

    const deletedApps = await prisma.application.deleteMany({
      where: {
        userId: session.user.id,
        id: { in: owned.map((row) => row.id) },
      },
    });

    const stillLinked = await prisma.application.findMany({
      where: { jobId: { in: jobIds } },
      select: { jobId: true },
    });
    const linked = new Set(stillLinked.map((row) => row.jobId));
    const orphanIds = jobIds.filter((id) => !linked.has(id));

    let deletedJobs = 0;
    if (orphanIds.length > 0) {
      const result = await prisma.job.deleteMany({
        where: { id: { in: orphanIds } },
      });
      deletedJobs = result.count;
    }

    return NextResponse.json({
      deletedApplications: deletedApps.count,
      deletedJobs,
      message: `Removidas ${deletedApps.count} vaga(s) selecionada(s).`,
    });
  } catch (error) {
    console.error("delete selected jobs failed", error);
    return errorResponse("Erro ao remover vagas selecionadas.", 500);
  }
}
