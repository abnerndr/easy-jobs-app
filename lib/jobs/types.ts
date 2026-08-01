export type JobSourceName = "INDEED" | "LINKEDIN" | "REMOTIVE" | "ARBEITNOW" | "DEMO";

export type NormalizedJob = {
  source: JobSourceName;
  externalId: string;
  title: string;
  company: string;
  location: string;
  url: string;
  description: string;
  workMode?: "REMOTO" | "HIBRIDO" | "PRESENCIAL" | null;
};

export type SearchQuery = {
  jobTitles: string[];
  location: string;
  workMode?: string;
  techStack?: string[];
  limit?: number;
};

export function buildDedupeKey(job: Pick<NormalizedJob, "source" | "externalId" | "url">): string {
  return `${job.source}:${job.externalId || job.url}`;
}

export function inferWorkMode(text: string): NormalizedJob["workMode"] {
  const lower = text.toLowerCase();
  if (lower.includes("remoto") || lower.includes("remote") || lower.includes("home office")) {
    return "REMOTO";
  }
  if (lower.includes("híbrido") || lower.includes("hibrido") || lower.includes("hybrid")) {
    return "HIBRIDO";
  }
  if (lower.includes("presencial") || lower.includes("on-site") || lower.includes("onsite")) {
    return "PRESENCIAL";
  }
  return null;
}

export function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
