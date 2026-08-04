import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiSession } from "@/lib/session";
import { errorResponse } from "@/lib/api-response";
import {
  connectJobBoard,
  importJobBoardSession,
} from "@/lib/jobs/board-browser";
import { deleteSessionFile } from "@/lib/jobs/session-store";
import type { JobBoardProvider } from "@/generated/prisma/client";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const PROVIDERS = new Set(["LINKEDIN", "INDEED"]);

type Params = { params: Promise<{ provider: string }> };

type ConnectBody = {
  mode?: "browser" | "import";
  cookies?: string;
  storageState?: unknown;
};

async function upsertConnection(
  userId: string,
  provider: JobBoardProvider,
  sessionPath: string
) {
  await prisma.jobBoardConnection.upsert({
    where: {
      userId_provider: {
        userId,
        provider,
      },
    },
    create: {
      userId,
      provider,
      sessionPath,
    },
    update: {
      sessionPath,
      connectedAt: new Date(),
    },
  });
}

export async function POST(request: Request, { params }: Params) {
  const session = await requireApiSession();
  if (!session) return errorResponse("Não autenticado.", 401);

  const { provider: raw } = await params;
  const provider = raw.toUpperCase();
  if (!PROVIDERS.has(provider)) {
    return errorResponse("Provedor inválido. Use linkedin ou indeed.", 400);
  }

  let body: ConnectBody = {};
  try {
    const text = await request.text();
    if (text.trim()) body = JSON.parse(text) as ConnectBody;
  } catch {
    return errorResponse("JSON inválido no corpo da requisição.", 400);
  }

  const wantsImport =
    body.mode === "import" ||
    Boolean(body.cookies?.trim()) ||
    body.storageState != null;

  try {
    const sessionPath = wantsImport
      ? await importJobBoardSession(
          session.user.id,
          provider as JobBoardProvider,
          { cookies: body.cookies, storageState: body.storageState }
        )
      : await connectJobBoard(
          session.user.id,
          provider as JobBoardProvider,
          { timeoutMs: 5 * 60_000 }
        );

    await upsertConnection(
      session.user.id,
      provider as JobBoardProvider,
      sessionPath
    );

    return NextResponse.json({
      provider,
      connected: true,
      mode: wantsImport ? "import" : "browser",
      message: wantsImport
        ? `${provider} conectado via cookies. Agora você pode buscar vagas.`
        : `${provider} conectado. Agora você pode buscar vagas.`,
    });
  } catch (error) {
    console.error("connect board failed", error);
    return errorResponse(
      error instanceof Error ? error.message : "Falha ao conectar.",
      500
    );
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const session = await requireApiSession();
  if (!session) return errorResponse("Não autenticado.", 401);

  const { provider: raw } = await params;
  const provider = raw.toUpperCase();
  if (!PROVIDERS.has(provider)) {
    return errorResponse("Provedor inválido.", 400);
  }

  try {
    await deleteSessionFile(session.user.id, provider as JobBoardProvider);
    await prisma.jobBoardConnection.deleteMany({
      where: {
        userId: session.user.id,
        provider: provider as JobBoardProvider,
      },
    });
    return NextResponse.json({ provider, connected: false });
  } catch (error) {
    console.error("disconnect board failed", error);
    return errorResponse("Erro ao desconectar.", 500);
  }
}
