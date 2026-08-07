import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiSession } from "@/lib/session";
import { errorResponse } from "@/lib/api-response";
import {
  cancelRemoteLogin,
  getRemoteLoginStatus,
  startRemoteLogin,
} from "@/lib/jobs/remote-login";
import type { JobBoardProvider } from "@/generated/prisma/client";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const PROVIDERS = new Set(["LINKEDIN", "INDEED"]);

type Params = { params: Promise<{ provider: string }> };

async function upsertConnection(
  userId: string,
  provider: JobBoardProvider,
  sessionPath: string
) {
  await prisma.jobBoardConnection.upsert({
    where: { userId_provider: { userId, provider } },
    create: { userId, provider, sessionPath },
    update: { sessionPath, connectedAt: new Date() },
  });
}

/** Inicia Chromium headed + noVNC para login interativo. */
export async function POST(_request: Request, { params }: Params) {
  const session = await requireApiSession();
  if (!session) return errorResponse("Não autenticado.", 401);

  const { provider: raw } = await params;
  const provider = raw.toUpperCase();
  if (!PROVIDERS.has(provider)) {
    return errorResponse("Provedor inválido.", 400);
  }

  try {
    const result = await startRemoteLogin(
      session.user.id,
      provider as JobBoardProvider
    );
    return NextResponse.json({
      provider,
      connected: false,
      status: result.status,
      sessionId: result.sessionId,
      displayMode: result.displayMode,
      novncUrl: result.novncUrl,
      expiresAt: result.expiresAt,
      message: result.message,
    });
  } catch (error) {
    console.error("remote login start failed", error);
    return errorResponse(
      error instanceof Error ? error.message : "Não foi possível abrir o login remoto.",
      500
    );
  }
}

export async function GET(request: Request, { params }: Params) {
  const session = await requireApiSession();
  if (!session) return errorResponse("Não autenticado.", 401);

  const { provider: raw } = await params;
  const provider = raw.toUpperCase();
  if (!PROVIDERS.has(provider)) {
    return errorResponse("Provedor inválido.", 400);
  }

  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (!sessionId) return errorResponse("sessionId obrigatório.", 400);

  const status = getRemoteLoginStatus(sessionId, session.user.id);

  if (status.status === "connected" && status.sessionPath) {
    await upsertConnection(
      session.user.id,
      provider as JobBoardProvider,
      status.sessionPath
    );
  }

  return NextResponse.json(status);
}

export async function DELETE(request: Request, { params }: Params) {
  const session = await requireApiSession();
  if (!session) return errorResponse("Não autenticado.", 401);

  const { provider: raw } = await params;
  const provider = raw.toUpperCase();
  if (!PROVIDERS.has(provider)) {
    return errorResponse("Provedor inválido.", 400);
  }

  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (!sessionId) return errorResponse("sessionId obrigatório.", 400);

  await cancelRemoteLogin(sessionId, session.user.id);
  return NextResponse.json({ cancelled: true });
}
