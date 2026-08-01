import { Queue } from "bullmq";
import IORedis from "ioredis";

export const JOB_SEARCH_QUEUE = "job-search";

export type JobSearchPayload = {
  userId: string;
};

let connection: IORedis | null = null;
let queue: Queue<JobSearchPayload> | null = null;

export function getRedisUrl() {
  return process.env.REDIS_URL?.trim() || "";
}

export function isQueueEnabled() {
  return Boolean(getRedisUrl());
}

function getConnection() {
  const url = getRedisUrl();
  if (!url) {
    throw new Error("REDIS_URL não configurada.");
  }
  if (!connection) {
    connection = new IORedis(url, { maxRetriesPerRequest: null });
  }
  return connection;
}

export function getJobSearchQueue() {
  if (!queue) {
    queue = new Queue<JobSearchPayload>(JOB_SEARCH_QUEUE, {
      connection: getConnection(),
    });
  }
  return queue;
}

export async function enqueueJobSearch(userId: string) {
  const q = getJobSearchQueue();
  const job = await q.add(
    "search",
    { userId },
    {
      removeOnComplete: 100,
      removeOnFail: 50,
      attempts: 2,
      backoff: { type: "exponential", delay: 2000 },
    }
  );
  return job.id;
}
