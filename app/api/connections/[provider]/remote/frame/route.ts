import { requireApiSession } from "@/lib/session";
import { errorResponse } from "@/lib/api-response";
import { getRemoteLoginFrame } from "@/lib/jobs/remote-login";

export const dynamic = "force-dynamic";

const PROVIDERS = new Set(["LINKEDIN", "INDEED"]);

type Params = { params: Promise<{ provider: string }> };

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

  const frame = await getRemoteLoginFrame(sessionId, session.user.id);
  if (!frame) {
    return errorResponse("Frame indisponível.", 404);
  }

  return new Response(new Uint8Array(frame), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
