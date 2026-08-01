import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiSession } from "@/lib/session";
import { profileSchema } from "@/lib/schemas/profile";
import { errorResponse, validationErrorResponse } from "@/lib/api-response";

export async function GET() {
  const session = await requireApiSession();
  if (!session) return errorResponse("Não autenticado.", 401);

  try {
    const profile = await prisma.profile.findUnique({
      where: { userId: session.user.id },
    });

    return NextResponse.json({ profile });
  } catch (error) {
    console.error("profile fetch failed", error);
    return errorResponse("Erro ao carregar perfil.", 500);
  }
}

export async function PUT(request: Request) {
  const session = await requireApiSession();
  if (!session) return errorResponse("Não autenticado.", 401);

  const body = await request.json().catch(() => null);
  if (!body) return errorResponse("Corpo da requisição inválido.", 400);

  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  try {
    const profile = await prisma.profile.upsert({
      where: { userId: session.user.id },
      create: { ...parsed.data, userId: session.user.id },
      update: parsed.data,
    });

    return NextResponse.json({ profile });
  } catch (error) {
    console.error("profile save failed", error);
    return errorResponse("Erro ao salvar perfil.", 500);
  }
}
