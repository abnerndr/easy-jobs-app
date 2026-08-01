import { prisma } from "@/lib/prisma";

/**
 * Removes DEMO applications for the user and orphan DEMO jobs.
 * Returns how many applications and jobs were deleted.
 */
export async function clearDemoJobsForUser(userId: string) {
  const demoApps = await prisma.application.findMany({
    where: {
      userId,
      job: { source: "DEMO" },
    },
    select: { id: true, jobId: true },
  });

  const jobIds = [...new Set(demoApps.map((app) => app.jobId))];

  const deletedApps = await prisma.application.deleteMany({
    where: {
      id: { in: demoApps.map((app) => app.id) },
    },
  });

  // Remove DEMO jobs that no longer have any applications
  let deletedJobs = 0;
  if (jobIds.length > 0) {
    const stillLinked = await prisma.application.findMany({
      where: { jobId: { in: jobIds } },
      select: { jobId: true },
    });
    const linked = new Set(stillLinked.map((row) => row.jobId));
    const orphanIds = jobIds.filter((id) => !linked.has(id));

    if (orphanIds.length > 0) {
      const result = await prisma.job.deleteMany({
        where: {
          id: { in: orphanIds },
          source: "DEMO",
        },
      });
      deletedJobs = result.count;
    }
  }

  // Also purge any leftover global DEMO jobs with zero applications
  const leftover = await prisma.job.deleteMany({
    where: {
      source: "DEMO",
      applications: { none: {} },
    },
  });
  deletedJobs += leftover.count;

  return {
    deletedApplications: deletedApps.count,
    deletedJobs,
  };
}
