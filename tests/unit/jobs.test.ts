import { describe, expect, it } from "vitest";
import { computeMatchScore } from "@/lib/jobs/match-score";
import { passesMinMatchFilter } from "@/lib/jobs/search";
import { buildDedupeKey } from "@/lib/jobs/types";
import { buildDemoJobs } from "@/lib/jobs/sources";
import { jobSettingsSchema, applicationsQuerySchema } from "@/lib/schemas/jobs";

describe("computeMatchScore", () => {
  it("scores higher when title and stack overlap", () => {
    const score = computeMatchScore(
      {
        jobTitles: ["Desenvolvedor Backend"],
        techStack: ["Node", "PostgreSQL"],
      },
      {
        title: "Desenvolvedor Backend Pleno",
        description: "Experiência com Node e PostgreSQL",
      }
    );
    expect(score).toBeGreaterThanOrEqual(70);
  });

  it("scores low when there is no overlap", () => {
    const score = computeMatchScore(
      {
        jobTitles: ["Mobile Flutter"],
        techStack: ["Dart"],
      },
      {
        title: "Analista de Marketing",
        description: "Campanhas e SEO",
      }
    );
    expect(score).toBeLessThan(30);
  });
});

describe("passesMinMatchFilter", () => {
  it("accepts scores at or above the minimum", () => {
    expect(passesMinMatchFilter(50, 50)).toBe(true);
    expect(passesMinMatchFilter(80, 50)).toBe(true);
  });

  it("rejects scores below the minimum", () => {
    expect(passesMinMatchFilter(49, 50)).toBe(false);
    expect(passesMinMatchFilter(0, 1)).toBe(false);
  });
});

describe("buildDedupeKey", () => {
  it("builds a stable key from source and external id", () => {
    expect(
      buildDedupeKey({
        source: "INDEED",
        externalId: "abc",
        url: "https://example.com",
      })
    ).toBe("INDEED:abc");
  });
});

describe("buildDemoJobs", () => {
  it("creates demo jobs from profile titles", () => {
    const jobs = buildDemoJobs({
      jobTitles: ["Engenheiro de Software"],
      location: "Remoto",
      workMode: "REMOTO",
    });
    expect(jobs.length).toBe(3);
    expect(jobs.every((j) => j.source === "DEMO")).toBe(true);
    expect(jobs[0].title).toContain("Engenheiro de Software");
  });
});

describe("jobSettingsSchema", () => {
  it("accepts payload without minMatchScore (backward compat)", () => {
    expect(
      jobSettingsSchema.safeParse({ dailyApplyLimit: 10, autoQueue: true }).success
    ).toBe(true);
  });

  it("accepts valid daily limit and minMatchScore", () => {
    expect(
      jobSettingsSchema.safeParse({ dailyApplyLimit: 10, minMatchScore: 50 }).success
    ).toBe(true);
  });

  it("rejects limit below 1", () => {
    expect(
      jobSettingsSchema.safeParse({ dailyApplyLimit: 0, minMatchScore: 50 }).success
    ).toBe(false);
  });

  it("rejects minMatchScore below 0", () => {
    expect(
      jobSettingsSchema.safeParse({ dailyApplyLimit: 10, minMatchScore: -1 }).success
    ).toBe(false);
  });

  it("rejects minMatchScore above 100", () => {
    expect(
      jobSettingsSchema.safeParse({ dailyApplyLimit: 10, minMatchScore: 101 }).success
    ).toBe(false);
  });

  it("accepts minMatchScore at bounds 0 and 100", () => {
    expect(
      jobSettingsSchema.safeParse({ dailyApplyLimit: 10, minMatchScore: 0 }).success
    ).toBe(true);
    expect(
      jobSettingsSchema.safeParse({ dailyApplyLimit: 10, minMatchScore: 100 }).success
    ).toBe(true);
  });
});

describe("applicationsQuerySchema", () => {
  it("accepts a known status", () => {
    expect(applicationsQuerySchema.safeParse({ status: "QUEUED" }).success).toBe(true);
  });

  it("accepts MATCHED status", () => {
    expect(applicationsQuerySchema.safeParse({ status: "MATCHED" }).success).toBe(true);
  });

  it("rejects an unknown status", () => {
    expect(applicationsQuerySchema.safeParse({ status: "NOPE" }).success).toBe(false);
  });
});

describe("applySelectedSchema", () => {
  it("requires at least one id", async () => {
    const { applySelectedSchema } = await import("@/lib/schemas/jobs");
    expect(applySelectedSchema.safeParse({ applicationIds: [] }).success).toBe(
      false
    );
    expect(
      applySelectedSchema.safeParse({ applicationIds: ["a1"] }).success
    ).toBe(true);
  });
});

describe("form-fill heuristics", () => {
  it("returns email/name without calling AI", async () => {
    const { answerFormQuestion } = await import("@/lib/ai/form-fill");
    const profile = {
      name: "Ana Silva",
      email: "ana@example.com",
      jobTitles: ["Backend"],
      seniority: "PLENO",
      techStack: ["Node"],
      location: "São Paulo",
      workMode: "REMOTO",
      salaryMin: 12000,
      contractTypes: ["CLT"],
    };
    await expect(
      answerFormQuestion(profile, {
        question: "Email",
        fieldType: "text",
      })
    ).resolves.toBe("ana@example.com");
    await expect(
      answerFormQuestion(profile, {
        question: "Nome completo",
        fieldType: "text",
      })
    ).resolves.toBe("Ana Silva");
  });
});
