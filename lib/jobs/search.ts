import { prisma, Prisma } from "@/lib/prisma";
import { computeMatchScore } from "@/lib/jobs/match-score";
import {
  scrapeIndeedJobs,
  scrapeLinkedInJobs,
} from "@/lib/jobs/board-browser";
import { buildDedupeKey, type JobSourceName, type NormalizedJob } from "@/lib/jobs/types";
import { sessionExists } from "@/lib/jobs/session-store";

const COUNTED_STATUSES = ["FOUND", "QUEUED", "APPLIED"] as const;

function startOfUtcDay(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export async function getOrCreateJobSettings(userId: string) {
  return prisma.userJobSettings.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}

export async function countTodayUsage(userId: string) {
  return prisma.application.count({
    where: {
      userId,
      status: { in: [...COUNTED_STATUSES] },
      createdAt: { gte: startOfUtcDay() },
    },
  });
}

async function upsertJobs(jobs: NormalizedJob[]) {
  const saved: { id: string; title: string; description: string }[] = [];

  for (const job of jobs) {
    const dedupeKey = buildDedupeKey(job);
    const row = await prisma.job.upsert({
      where: { dedupeKey },
      create: {
        source: job.source,
        externalId: job.externalId,
        title: job.title,
        company: job.company,
        location: job.location,
        url: job.url,
        description: job.description,
        workMode: job.workMode ?? null,
        dedupeKey,
      },
      update: {
        title: job.title,
        company: job.company,
        location: job.location,
        url: job.url,
        description: job.description,
        workMode: job.workMode ?? null,
        fetchedAt: new Date(),
      },
    });
    saved.push({ id: row.id, title: row.title, description: row.description });
  }

  return saved;
}

export type JobSearchResult = {
  created: number;
  skippedLimit: number;
  source: JobSourceName | "MIXED";
  remainingToday: number;
  sourcesUsed: JobSourceName[];
};

export async function runJobSearch(userId: string): Promise<JobSearchResult> {
  const profile = await prisma.profile.findUnique({ where: { userId } });
  if (!profile) {
    throw new Error("Complete o perfil antes de buscar vagas.");
  }

  const connections = await prisma.jobBoardConnection.findMany({
    where: { userId },
  });

  const linkedInOk =
    connections.some((c) => c.provider === "LINKEDIN") &&
    (await sessionExists(userId, "LINKEDIN"));
  const indeedOk =
    connections.some((c) => c.provider === "INDEED") &&
    (await sessionExists(userId, "INDEED"));

  if (!linkedInOk && !indeedOk) {
    throw new Error(
      "Conecte LinkedIn ou Indeed antes de buscar vagas. Use os botões Conectar no painel."
    );
  }

  const settings = await getOrCreateJobSettings(userId);
  const usedToday = await countTodayUsage(userId);
  const remaining = Math.max(0, settings.dailyApplyLimit - usedToday);

  if (remaining === 0) {
    return {
      created: 0,
      skippedLimit: 0,
      source: "MIXED",
      remainingToday: 0,
      sourcesUsed: [],
    };
  }

  const query = {
    jobTitles: profile.jobTitles,
    location: profile.location,
    workMode: profile.workMode,
    techStack: profile.techStack,
    limit: Math.min(15, remaining + 5),
  };

  const collected: NormalizedJob[] = [];
  const sourcesUsed: JobSourceName[] = [];
  const errors: string[] = [];

  if (linkedInOk) {
    try {
      const jobs = await scrapeLinkedInJobs(userId, query);
      collected.push(...jobs);
      if (jobs.length > 0) sourcesUsed.push("LINKEDIN");
      await prisma.jobBoardConnection.update({
        where: { userId_provider: { userId, provider: "LINKEDIN" } },
        data: { lastUsedAt: new Date() },
      });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "LinkedIn falhou");
    }
  }

  if (indeedOk) {
    try {
      const jobs = await scrapeIndeedJobs(userId, query);
      collected.push(...jobs);
      if (jobs.length > 0) sourcesUsed.push("INDEED");
      await prisma.jobBoardConnection.update({
        where: { userId_provider: { userId, provider: "INDEED" } },
        data: { lastUsedAt: new Date() },
      });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Indeed falhou");
    }
  }

  if (collected.length === 0) {
    throw new Error(
      errors.length > 0
        ? errors.join(" ")
        : "Nenhuma vaga encontrada. Tente outros critérios no perfil."
    );
  }

  const savedJobs = await upsertJobs(collected.slice(0, remaining + 10));
  let created = 0;
  let skippedLimit = 0;

  for (const job of savedJobs) {
    if (created >= remaining) {
      skippedLimit += 1;
      continue;
    }

    const matchScore = computeMatchScore(
      { jobTitles: profile.jobTitles, techStack: profile.techStack },
      { title: job.title, description: job.description }
    );

    const status = settings.autoQueue ? "QUEUED" : "FOUND";

    try {
      await prisma.application.create({
        data: {
          userId,
          jobId: job.id,
          status,
          matchScore,
        },
      });
      created += 1;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        continue;
      }
      throw error;
    }
  }

  const remainingToday = Math.max(0, settings.dailyApplyLimit - usedToday - created);
  const source: JobSourceName | "MIXED" =
    sourcesUsed.length === 1 ? sourcesUsed[0] : "MIXED";

  return { created, skippedLimit, source, remainingToday, sourcesUsed };
}
