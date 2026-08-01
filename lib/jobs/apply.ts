import path from "node:path";
import { prisma } from "@/lib/prisma";
import { getConfiguredAiProvider, type ApplicantContext } from "@/lib/ai/form-fill";
import { applyLinkedInEasyApply } from "@/lib/jobs/easy-apply";
import { sessionExists } from "@/lib/jobs/session-store";
import { getOrCreateJobSettings } from "@/lib/jobs/search";

function startOfUtcDay(date = new Date()) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
}

export type ApplyBatchResult = {
  processed: number;
  applied: number;
  external: number;
  failed: number;
  skipped: number;
  remainingApplyQuota: number;
  results: {
    applicationId: string;
    status: string;
    message?: string;
  }[];
  message: string;
};

async function loadApplicantContext(userId: string): Promise<{
  profile: ApplicantContext;
  resumePath: string | null;
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { profile: true, resume: true },
  });
  if (!user?.profile) {
    throw new Error("Complete o perfil antes de se candidatar.");
  }

  const yearsHint =
    user.profile.seniority === "JUNIOR"
      ? "1-2 anos"
      : user.profile.seniority === "PLENO"
        ? "3-5 anos"
        : user.profile.seniority === "SENIOR"
          ? "6-10 anos"
          : "10+ anos";

  return {
    profile: {
      name: user.name,
      email: user.email,
      jobTitles: user.profile.jobTitles,
      seniority: user.profile.seniority,
      techStack: user.profile.techStack,
      location: user.profile.location,
      workMode: user.profile.workMode,
      salaryMin: user.profile.salaryMin,
      contractTypes: user.profile.contractTypes,
      yearsExperienceHint: yearsHint,
    },
    resumePath: user.resume
      ? path.isAbsolute(user.resume.filePath)
        ? user.resume.filePath
        : path.resolve(process.cwd(), user.resume.filePath)
      : null,
  };
}

async function countAppliedToday(userId: string) {
  return prisma.application.count({
    where: {
      userId,
      status: "APPLIED",
      updatedAt: { gte: startOfUtcDay() },
    },
  });
}

/**
 * Applies to selected LinkedIn Easy Apply jobs (sync, Playwright).
 */
export async function runApplySelected(
  userId: string,
  applicationIds: string[]
): Promise<ApplyBatchResult> {
  if (applicationIds.length === 0) {
    throw new Error("Selecione ao menos uma vaga.");
  }

  if (!getConfiguredAiProvider()) {
    throw new Error(
      "Configure OPENAI_API_KEY ou GEMINI_API_KEY no .env para preencher formulários com IA."
    );
  }

  const linkedInOk = await sessionExists(userId, "LINKEDIN");
  if (!linkedInOk) {
    throw new Error("Conecte o LinkedIn antes de se candidatar via Easy Apply.");
  }

  const settings = await getOrCreateJobSettings(userId);
  const appliedToday = await countAppliedToday(userId);
  const applyQuota = Math.max(0, settings.dailyApplyLimit - appliedToday);
  if (applyQuota === 0) {
    return {
      processed: 0,
      applied: 0,
      external: 0,
      failed: 0,
      skipped: 0,
      remainingApplyQuota: 0,
      results: [],
      message: "Limite diário de candidaturas atingido.",
    };
  }

  const { profile, resumePath } = await loadApplicantContext(userId);

  const apps = await prisma.application.findMany({
    where: {
      userId,
      id: { in: applicationIds },
    },
    include: { job: true },
    orderBy: { createdAt: "asc" },
  });

  const eligible = apps.filter(
    (a) =>
      a.job.source === "LINKEDIN" &&
      (a.status === "FOUND" || a.status === "QUEUED" || a.status === "FAILED")
  );

  const toProcess = eligible.slice(0, applyQuota);
  const results: ApplyBatchResult["results"] = [];
  let applied = 0;
  let external = 0;
  let failed = 0;
  let skipped = 0;

  for (const app of toProcess) {
    await prisma.application.update({
      where: { id: app.id },
      data: { status: "QUEUED", errorMessage: null },
    });

    try {
      const outcome = await applyLinkedInEasyApply({
        userId,
        job: {
          title: app.job.title,
          company: app.job.company,
          url: app.job.url,
        },
        profile,
        resumeFilePath: resumePath,
      });

      await prisma.application.update({
        where: { id: app.id },
        data: {
          status: outcome.status,
          errorMessage:
            outcome.status === "APPLIED" ? null : outcome.message ?? null,
        },
      });

      await prisma.jobBoardConnection.updateMany({
        where: { userId, provider: "LINKEDIN" },
        data: { lastUsedAt: new Date() },
      });

      if (outcome.status === "APPLIED") applied += 1;
      else if (outcome.status === "EXTERNAL_REDIRECT") external += 1;
      else if (outcome.status === "FAILED") failed += 1;
      else skipped += 1;

      results.push({
        applicationId: app.id,
        status: outcome.status,
        message: outcome.message,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Erro ao candidatar.";
      await prisma.application.update({
        where: { id: app.id },
        data: { status: "FAILED", errorMessage: message.slice(0, 500) },
      });
      failed += 1;
      results.push({
        applicationId: app.id,
        status: "FAILED",
        message,
      });
    }
  }

  const skippedNotLinkedIn = apps.filter((a) => a.job.source !== "LINKEDIN").length;
  const remainingApplyQuota = Math.max(
    0,
    settings.dailyApplyLimit - (await countAppliedToday(userId))
  );

  return {
    processed: toProcess.length,
    applied,
    external,
    failed,
    skipped: skipped + skippedNotLinkedIn,
    remainingApplyQuota,
    results,
    message:
      toProcess.length === 0
        ? skippedNotLinkedIn > 0
          ? "Nenhuma vaga LinkedIn elegível nas selecionadas (Easy Apply só no LinkedIn)."
          : "Nenhuma vaga elegível (já aplicadas ou status inválido)."
        : `Processadas ${toProcess.length}: ${applied} enviada(s), ${external} externa(s), ${failed} falha(s), ${skipped} ignorada(s).`,
  };
}
