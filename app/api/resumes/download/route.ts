import { readFile } from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import { requireApiSession } from "@/lib/session";
import { errorResponse } from "@/lib/api-response";

export async function GET() {
  const session = await requireApiSession();
  if (!session) return errorResponse("Não autenticado.", 401);

  try {
    const resume = await prisma.resume.findUnique({ where: { userId: session.user.id } });
    if (!resume) return errorResponse("Nenhum currículo encontrado.", 404);

    const buffer = await readFile(resume.filePath).catch(() => null);
    if (!buffer) return errorResponse("Arquivo não encontrado no armazenamento.", 404);

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": resume.mimeType,
        "Content-Disposition": `attachment; filename="${resume.fileName}"`,
      },
    });
  } catch (error) {
    console.error("resume download failed", error);
    return errorResponse("Erro ao baixar currículo.", 500);
  }
}
