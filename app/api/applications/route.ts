import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiSession } from "@/lib/session";
import { errorResponse, validationErrorResponse } from "@/lib/api-response";
import { applicationsQuerySchema } from "@/lib/schemas/jobs";

export async function GET(request: Request) {
  const session = await requireApiSession();
  if (!session) return errorResponse("Não autenticado.", 401);

  const { searchParams } = new URL(request.url);
  const parsed = applicationsQuerySchema.safeParse({
    status: searchParams.get("status") ?? undefined,
  });
  if (!parsed.success) return validationErrorResponse(parsed.error);

  try {
    const applications = await prisma.application.findMany({
      where: {
        userId: session.user.id,
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
      include: { job: true },
    });

    return NextResponse.json({
      applications: applications.map((app) => ({
        id: app.id,
        status: app.status,
        matchScore: app.matchScore,
        errorMessage: app.errorMessage,
        createdAt: app.createdAt,
        updatedAt: app.updatedAt,
        job: {
          id: app.job.id,
          title: app.job.title,
          company: app.job.company,
          location: app.job.location,
          url: app.job.url,
          source: app.job.source,
        },
      })),
    });
  } catch (error) {
    console.error("applications list failed", error);
    return errorResponse("Erro ao listar candidaturas.", 500);
  }
}
