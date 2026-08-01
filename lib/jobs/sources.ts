import type { JobSourceName, NormalizedJob, SearchQuery } from "@/lib/jobs/types";
import { inferWorkMode, stripHtml } from "@/lib/jobs/types";

type RemotiveJob = {
  id: number;
  url: string;
  title: string;
  company_name: string;
  candidate_required_location?: string;
  description?: string;
  job_type?: string;
};

type ArbeitnowJob = {
  slug: string;
  url?: string;
  title: string;
  company_name: string;
  location?: string;
  description?: string;
  remote?: boolean;
  tags?: string[];
};

function searchTerms(query: SearchQuery) {
  return [...query.jobTitles, ...(query.techStack ?? [])]
    .map((term) => term.trim())
    .filter(Boolean);
}

function matchesQuery(job: Pick<NormalizedJob, "title" | "description">, query: SearchQuery) {
  const terms = searchTerms(query).map((term) => term.toLowerCase());
  if (terms.length === 0) return true;
  const haystack = `${job.title} ${job.description}`.toLowerCase();
  return terms.some((term) => haystack.includes(term.toLowerCase()) || term.split(/\s+/).some((part) => part.length > 2 && haystack.includes(part)));
}

export async function fetchRemotiveJobs(query: SearchQuery): Promise<NormalizedJob[]> {
  const search = encodeURIComponent(query.jobTitles.slice(0, 2).join(" ") || "developer");
  const response = await fetch(`https://remotive.com/api/remote-jobs?search=${search}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Remotive respondeu ${response.status}`);
  }

  const body = (await response.json()) as { jobs?: RemotiveJob[] };
  const limit = query.limit ?? 25;

  return (body.jobs ?? [])
    .slice(0, limit * 2)
    .map((job) => {
      const description = stripHtml(job.description ?? "");
      return {
        source: "REMOTIVE" as const,
        externalId: String(job.id),
        title: job.title,
        company: job.company_name || "Empresa não informada",
        location: job.candidate_required_location || "Remote",
        url: job.url,
        description: description.slice(0, 2000) || job.title,
        workMode: "REMOTO" as const,
      };
    })
    .filter((job) => matchesQuery(job, query))
    .slice(0, limit);
}

export async function fetchArbeitnowJobs(query: SearchQuery): Promise<NormalizedJob[]> {
  const response = await fetch("https://www.arbeitnow.com/api/job-board-api", {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Arbeitnow respondeu ${response.status}`);
  }

  const body = (await response.json()) as { data?: ArbeitnowJob[] };
  const limit = query.limit ?? 25;

  return (body.data ?? [])
    .slice(0, 100)
    .map((job) => {
      const description = stripHtml(job.description ?? "");
      const location = job.location || (job.remote ? "Remote" : "Não informado");
      return {
        source: "ARBEITNOW" as const,
        externalId: job.slug,
        title: job.title,
        company: job.company_name || "Empresa não informada",
        location,
        url: job.url || `https://www.arbeitnow.com/jobs/${job.slug}`,
        description: description.slice(0, 2000) || job.title,
        workMode: job.remote ? ("REMOTO" as const) : inferWorkMode(`${job.title} ${location}`),
      };
    })
    .filter((job) => matchesQuery(job, query))
    .slice(0, limit);
}

export function buildDemoJobs(query: SearchQuery): NormalizedJob[] {
  const titles = query.jobTitles.length > 0 ? query.jobTitles : ["Desenvolvedor"];
  const location = query.location || "Remoto - Brasil";
  const stackHint = [...titles, ...(query.techStack ?? [])].join(" / ");
  const now = Date.now();

  return titles.flatMap((title, titleIndex) =>
    [1, 2, 3].map((n) => {
      const externalId = `demo-${now}-${titleIndex}-${n}`;
      return {
        source: "DEMO" as const,
        externalId,
        title: `${title} ${n === 1 ? "Pleno" : n === 2 ? "Sênior" : "Jr"}`,
        company: ["Nimbus Tech", "Aurora Labs", "Orbit Systems"][n - 1],
        location,
        url: `https://example.com/jobs/${externalId}`,
        description: `Vaga de ${title} focada em ${stackHint}. Gerada em modo demonstração quando as APIs públicas estão indisponíveis.`,
        workMode: (query.workMode as NormalizedJob["workMode"]) ?? "REMOTO",
      };
    })
  );
}

export type FetchJobsResult = {
  jobs: NormalizedJob[];
  source: JobSourceName;
};

/**
 * Prefer public job APIs (Remotive, Arbeitnow). Indeed HTML is blocked (403)
 * from most server IPs, so it is not used as a primary source.
 */
export async function fetchJobsFromSources(query: SearchQuery): Promise<FetchJobsResult> {
  const errors: string[] = [];

  try {
    const remotive = await fetchRemotiveJobs(query);
    if (remotive.length > 0) {
      return { jobs: remotive, source: "REMOTIVE" };
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Remotive falhou");
  }

  try {
    const arbeitnow = await fetchArbeitnowJobs(query);
    if (arbeitnow.length > 0) {
      return { jobs: arbeitnow, source: "ARBEITNOW" };
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Arbeitnow falhou");
  }

  if (errors.length > 0) {
    console.warn("Public job APIs unavailable, using demo jobs:", errors.join("; "));
  }

  return { jobs: buildDemoJobs(query), source: "DEMO" };
}
