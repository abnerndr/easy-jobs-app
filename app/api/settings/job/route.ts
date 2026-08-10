import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiSession } from "@/lib/session";
import { errorResponse, validationErrorResponse } from "@/lib/api-response";
import { jobSettingsSchema } from "@/lib/schemas/jobs";
import { getOrCreateJobSettings } from "@/lib/jobs/search";

export async function GET() {
  const session = await requireApiSession();
  if (!session) return errorResponse("Não autenticado.", 401);

  try {
    const settings = await getOrCreateJobSettings(session.user.id);

    return NextResponse.json({
      settings: {
        searchTarget: settings.searchTarget,
        autoQueue: settings.autoQueue,
        minMatchScore: settings.minMatchScore ?? 50,
      },
    });
  } catch (error) {
    console.error("job settings fetch failed", error);
    return errorResponse("Erro ao carregar configurações.", 500);
  }
}

export async function PATCH(request: Request) {
  const session = await requireApiSession();
  if (!session) return errorResponse("Não autenticado.", 401);

  const body = await request.json().catch(() => null);
  if (!body) return errorResponse("Corpo da requisição inválido.", 400);

  const parsed = jobSettingsSchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  try {
    const settings = await prisma.userJobSettings.upsert({
      where: { userId: session.user.id },
      create: {
        userId: session.user.id,
        searchTarget: parsed.data.searchTarget,
        autoQueue: parsed.data.autoQueue ?? true,
        minMatchScore: parsed.data.minMatchScore ?? 50,
      },
      update: {
        searchTarget: parsed.data.searchTarget,
        ...(parsed.data.autoQueue !== undefined
          ? { autoQueue: parsed.data.autoQueue }
          : {}),
        ...(parsed.data.minMatchScore !== undefined
          ? { minMatchScore: parsed.data.minMatchScore }
          : {}),
      },
    });

    return NextResponse.json({
      settings: {
        searchTarget: settings.searchTarget,
        autoQueue: settings.autoQueue,
        minMatchScore: settings.minMatchScore ?? 50,
      },
    });
  } catch (error) {
    console.error("job settings update failed", error);
    return errorResponse("Erro ao salvar configurações.", 500);
  }
}
