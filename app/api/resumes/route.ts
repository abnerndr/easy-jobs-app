import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiSession } from "@/lib/session";
import { errorResponse } from "@/lib/api-response";

const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const STORAGE_DIR = process.env.RESUME_STORAGE_DIR ?? "./data/resumes";

export async function GET() {
  const session = await requireApiSession();
  if (!session) return errorResponse("Não autenticado.", 401);

  try {
    const resume = await prisma.resume.findUnique({ where: { userId: session.user.id } });
    return NextResponse.json({ resume });
  } catch (error) {
    console.error("resume fetch failed", error);
    return errorResponse("Erro ao carregar currículo.", 500);
  }
}

export async function POST(request: Request) {
  const session = await requireApiSession();
  if (!session) return errorResponse("Não autenticado.", 401);

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) return errorResponse("Arquivo não enviado.", 400);
  if (file.type !== "application/pdf") return errorResponse("Envie um arquivo PDF.", 400);
  if (file.size > MAX_SIZE_BYTES) return errorResponse("Arquivo maior que 5MB.", 400);

  try {
    // RESUME_STORAGE_DIR is an arbitrary runtime path (e.g. a mounted
    // volume outside the app's own source tree in production), not a
    // module import — turbopackIgnore tells the bundler not to trace
    // through it, so it doesn't fall back to bundling the whole project
    // into .next/standalone (see the "unexpected file in NFT list"
    // warning this silences).
    const userDir = path.join(/* turbopackIgnore: true */ STORAGE_DIR, session.user.id);
    await mkdir(userDir, { recursive: true });

    const existing = await prisma.resume.findUnique({ where: { userId: session.user.id } });

    // Write the new file and commit the DB row before touching the old
    // file, so a failure at either step leaves the previous resume intact
    // (worst case: one orphaned new file on disk, not a lost resume). The
    // new file always gets its own randomUUID() name, so this never
    // collides with the old one.
    const storedFileName = `${randomUUID()}.pdf`;
    const filePath = path.join(userDir, storedFileName);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, buffer);

    const resume = await prisma.resume.upsert({
      where: { userId: session.user.id },
      create: {
        userId: session.user.id,
        fileName: file.name,
        filePath,
        mimeType: file.type,
        size: file.size,
      },
      update: {
        fileName: file.name,
        filePath,
        mimeType: file.type,
        size: file.size,
        uploadedAt: new Date(),
      },
    });

    if (existing) {
      await unlink(existing.filePath).catch(() => {
        // Best-effort cleanup — a missing old file shouldn't block a new upload.
      });
    }

    return NextResponse.json({ resume });
  } catch (error) {
    console.error("resume upload failed", error);
    return errorResponse("Erro ao enviar currículo.", 500);
  }
}
