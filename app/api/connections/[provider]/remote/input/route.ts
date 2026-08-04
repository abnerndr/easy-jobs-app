import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiSession } from "@/lib/session";
import { errorResponse } from "@/lib/api-response";
import {
  sendRemoteLoginInput,
  type RemoteInputEvent,
} from "@/lib/jobs/remote-login";
import type { JobBoardProvider } from "@/generated/prisma/client";

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

export async function POST(request: Request, { params }: Params) {
  const session = await requireApiSession();
  if (!session) return errorResponse("Não autenticado.", 401);

  const { provider: raw } = await params;
  const provider = raw.toUpperCase();
  if (!PROVIDERS.has(provider)) {
    return errorResponse("Provedor inválido.", 400);
  }

  let body: { sessionId?: string; event?: RemoteInputEvent };
  try {
    body = (await request.json()) as { sessionId?: string; event?: RemoteInputEvent };
  } catch {
    return errorResponse("JSON inválido.", 400);
  }

  if (!body.sessionId || !body.event) {
    return errorResponse("sessionId e event são obrigatórios.", 400);
  }

  try {
    const status = await sendRemoteLoginInput(
      body.sessionId,
      session.user.id,
      body.event
    );

    if (status.status === "connected" && status.sessionPath) {
      await upsertConnection(
        session.user.id,
        provider as JobBoardProvider,
        status.sessionPath
      );
    }

    return NextResponse.json(status);
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Falha ao enviar input.",
      500
    );
  }
}
