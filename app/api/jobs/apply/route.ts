import { requireApiSession } from "@/lib/session";
import { errorResponse } from "@/lib/api-response";

// Easy Apply (candidatura automática) está temporariamente desativado.
// A implementação em `lib/jobs/apply.ts` / `lib/jobs/easy-apply.ts` /
// `lib/ai/form-fill.ts` foi mantida intacta para reativação futura.
export const dynamic = "force-dynamic";

export async function POST() {
  const session = await requireApiSession();
  if (!session) return errorResponse("Não autenticado.", 401);

  return errorResponse(
    "Candidatura automática (Easy Apply) está desativada por enquanto.",
    503
  );
}
