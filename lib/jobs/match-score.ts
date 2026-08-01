export type MatchProfile = {
  jobTitles: string[];
  techStack: string[];
};

export type MatchJob = {
  title: string;
  description: string;
};

function normalizeTokens(values: string[]): string[] {
  return values
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Heuristic match (0–100): title overlap weighs more than description.
 * Replaced by LLM scoring in phase C.
 */
export function computeMatchScore(profile: MatchProfile, job: MatchJob): number {
  const titles = normalizeTokens(profile.jobTitles);
  const stack = normalizeTokens(profile.techStack);
  const haystackTitle = job.title.toLowerCase();
  const haystackDesc = job.description.toLowerCase();
  const haystackAll = `${haystackTitle} ${haystackDesc}`;

  if (titles.length === 0 && stack.length === 0) return 0;

  let titleHits = 0;
  for (const title of titles) {
    if (haystackTitle.includes(title) || title.split(/\s+/).some((part) => part.length > 2 && haystackTitle.includes(part))) {
      titleHits += 1;
    }
  }

  let stackHits = 0;
  for (const tech of stack) {
    if (haystackAll.includes(tech)) stackHits += 1;
  }

  const titleScore = titles.length === 0 ? 40 : (titleHits / titles.length) * 60;
  const stackScore = stack.length === 0 ? 20 : (stackHits / stack.length) * 40;

  return Math.max(0, Math.min(100, Math.round(titleScore + stackScore)));
}
