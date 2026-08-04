import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiSession } from "@/lib/session";
import { errorResponse } from "@/lib/api-response";
import {
  cancelRemoteLogin,
  getRemoteLoginStatus,
  loginWithCredentials,
} from "@/lib/jobs/remote-login";
import type { JobBoardProvider } from "@/generated/prisma/client";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const PROVIDERS = new Set(["LINKEDIN", "INDEED"]);

type Params = { params: Promise<{ provider: string }> };

type ConnectBody = {
  email?: string;
  password?: string;
};

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

export async function POST(request: Request, { params }: Params) {
  const session = await requireApiSession();
  if (!session) return errorResponse("Não autenticado.", 401);

  const { provider: raw } = await params;
  const provider = raw.toUpperCase();
  if (!PROVIDERS.has(provider)) {
    return errorResponse("Provedor inválido.", 400);
  }

  let body: ConnectBody = {};
  try {
    body = (await request.json()) as ConnectBody;
  } catch {
    return errorResponse("JSON inválido. Envie email e password.", 400);
  }

  if (!body.email?.trim() || !body.password) {
    return errorResponse("Informe e-mail e senha da conta.", 400);
  }

  try {
    const sessionPath = await loginWithCredentials(
      session.user.id,
      provider as JobBoardProvider,
      { email: body.email, password: body.password }
    );

    await upsertConnection(
      session.user.id,
      provider as JobBoardProvider,
      sessionPath
    );

    return NextResponse.json({
      provider,
      connected: true,
      message: `${provider} conectado. Agora você pode buscar vagas.`,
    });
  } catch (error) {
    console.error("credential login failed", error);
    return errorResponse(
      error instanceof Error
        ? error.message
        : "Não foi possível fazer login.",
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
