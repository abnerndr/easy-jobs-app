import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiSession } from "@/lib/session";
import { errorResponse } from "@/lib/api-response";
import { sessionExists } from "@/lib/jobs/session-store";

export async function GET() {
  const session = await requireApiSession();
  if (!session) return errorResponse("Não autenticado.", 401);

  try {
    const rows = await prisma.jobBoardConnection.findMany({
      where: { userId: session.user.id },
    });

    const providers = ["LINKEDIN", "INDEED"] as const;
    const connections = await Promise.all(
      providers.map(async (provider) => {
        const row = rows.find((r) => r.provider === provider);
        const fileOk = await sessionExists(session.user.id, provider);
        return {
          provider,
          connected: Boolean(row && fileOk),
          connectedAt: row?.connectedAt ?? null,
          lastUsedAt: row?.lastUsedAt ?? null,
        };
      })
    );

    return NextResponse.json({
      connections,
      canSearch: connections.some((c) => c.connected),
    });
  } catch (error) {
    console.error("connections list failed", error);
    return errorResponse("Erro ao carregar conexões.", 500);
  }
}
