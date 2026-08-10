import { prisma, Prisma } from "@/lib/prisma";
import { computeMatchScore } from "@/lib/jobs/match-score";
import {
  scrapeIndeedJobs,
  scrapeLinkedInJobs,
} from "@/lib/jobs/board-browser";
import { buildDedupeKey, type NormalizedJob } from "@/lib/jobs/types";
import { sessionExists } from "@/lib/jobs/session-store";

type BoardSource = "LINKEDIN" | "INDEED";

export async function getOrCreateJobSettings(userId: string) {
  return prisma.userJobSettings.upsert({
    where: { userId },
    create: { userId },
    update: {},
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
        easyApply: job.easyApply ?? null,
        dedupeKey,
      },
      update: {
        title: job.title,
        company: job.company,
        location: job.location,
        url: job.url,
        description: job.description,
        workMode: job.workMode ?? null,
        easyApply: job.easyApply ?? null,
        fetchedAt: new Date(),
      },
    });
    saved.push({ id: row.id, title: row.title, description: row.description });
  }

  return saved;
}

export function passesMinMatchFilter(
  matchScore: number,
  minMatchScore: number
): boolean {
  return matchScore >= minMatchScore;
}

export type JobSearchResult = {
  created: number;
  skippedMinMatch: number;
  alreadyHad: number;
  searchTarget: number;
  minMatchScore: number;
  source: BoardSource | "MIXED";
  sourcesUsed: BoardSource[];
  sourceErrors: string[];
  pagesExhausted: boolean;
};

/**
 * Collects up to `searchTarget` NEW applications that pass minMatchScore.
 * Scrapers paginate until they gather enough candidates (or pages run out).
 */
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
  const searchTarget = Math.max(1, settings.searchTarget ?? 10);
  const minMatchScore = settings.minMatchScore ?? 50;

  const activeCount = (linkedInOk ? 1 : 0) + (indeedOk ? 1 : 0);
  // Each connected board scrapes independently so Indeed is never skipped
  // just because LinkedIn already filled a shared quota.
  const perSourceLimit = Math.min(
    80,
    Math.max(searchTarget * 4, Math.ceil((searchTarget * 5) / activeCount))
  );

  const baseQuery = {
    jobTitles: profile.jobTitles,
    location: profile.location,
    workMode: profile.workMode,
    techStack: profile.techStack,
    limit: perSourceLimit,
  };

  const collected: NormalizedJob[] = [];
  const sourcesUsed: BoardSource[] = [];
  const sourceErrors: string[] = [];
  const seenKeys = new Set<string>();

  async function takeFromSource(
    source: BoardSource,
    scrape: () => Promise<NormalizedJob[]>
  ) {
    try {
      const jobs = await scrape();
      let added = 0;
      for (const job of jobs) {
        const key = buildDedupeKey(job);
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        collected.push(job);
        added += 1;
      }
      if (added > 0) sourcesUsed.push(source);
      else if (jobs.length === 0) {
        sourceErrors.push(`${source}: nenhuma vaga encontrada.`);
      }
      await prisma.jobBoardConnection.update({
        where: { userId_provider: { userId, provider: source } },
        data: { lastUsedAt: new Date() },
      });
    } catch (error) {
      sourceErrors.push(
        error instanceof Error ? error.message : `${source} falhou`
      );
    }
  }

  // Run sources sequentially (shared machine / headed chrome). Always both
  // when connected — do not gate Indeed on LinkedIn fill.
  if (linkedInOk) {
    await takeFromSource("LINKEDIN", () =>
      scrapeLinkedInJobs(userId, baseQuery)
    );
  }
  if (indeedOk) {
    await takeFromSource("INDEED", () => scrapeIndeedJobs(userId, baseQuery));
  }

  if (collected.length === 0) {
    throw new Error(
      sourceErrors.length > 0
        ? sourceErrors.join(" ")
        : "Nenhuma vaga encontrada. Tente outros critérios no perfil."
    );
  }

  const savedJobs = await upsertJobs(collected);
  const scored = savedJobs
    .map((job) => ({
      ...job,
      matchScore: computeMatchScore(
        { jobTitles: profile.jobTitles, techStack: profile.techStack },
        { title: job.title, description: job.description }
      ),
    }))
    .sort((a, b) => b.matchScore - a.matchScore);

  let created = 0;
  let skippedMinMatch = 0;
  let alreadyHad = 0;
  const status = settings.autoQueue ? "QUEUED" : "FOUND";

  for (const job of scored) {
    if (!passesMinMatchFilter(job.matchScore, minMatchScore)) {
      skippedMinMatch += 1;
      continue;
    }
    if (created >= searchTarget) break;

    try {
      await prisma.application.create({
        data: {
          userId,
          jobId: job.id,
          status,
          matchScore: job.matchScore,
        },
      });
      created += 1;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        alreadyHad += 1;
        continue;
      }
      throw error;
    }
  }

  const source: BoardSource | "MIXED" =
    sourcesUsed.length === 1 ? sourcesUsed[0] : "MIXED";

  return {
    created,
    skippedMinMatch,
    alreadyHad,
    searchTarget,
    minMatchScore,
    source,
    sourcesUsed,
    sourceErrors,
    pagesExhausted: created < searchTarget,
  };
}
