import path from "node:path";
import fs from "node:fs/promises";
import type { JobBoardProvider } from "@/generated/prisma/client";

const SESSIONS_ROOT = path.join(process.cwd(), "data", "sessions");

export function sessionFilePath(userId: string, provider: JobBoardProvider) {
  return path.join(SESSIONS_ROOT, userId, `${provider.toLowerCase()}.json`);
}

export async function ensureSessionsDir(userId: string) {
  const dir = path.join(SESSIONS_ROOT, userId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function sessionExists(userId: string, provider: JobBoardProvider) {
  try {
    await fs.access(sessionFilePath(userId, provider));
    return true;
  } catch {
    return false;
  }
}

export async function deleteSessionFile(userId: string, provider: JobBoardProvider) {
  try {
    await fs.unlink(sessionFilePath(userId, provider));
  } catch {
    // ignore missing file
  }
}
