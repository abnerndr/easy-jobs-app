import "dotenv/config";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { JOB_SEARCH_QUEUE, type JobSearchPayload, getRedisUrl } from "../lib/jobs/queue";
import { runJobSearch } from "../lib/jobs/search";

const redisUrl = getRedisUrl();
if (!redisUrl) {
  console.error("REDIS_URL is required to run the worker.");
  process.exit(1);
}

const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

const worker = new Worker<JobSearchPayload>(
  JOB_SEARCH_QUEUE,
  async (job) => {
    console.log(`Processing job-search for user ${job.data.userId}`);
    const result = await runJobSearch(job.data.userId);
    console.log(`Done user=${job.data.userId}`, result);
    return result;
  },
  { connection }
);

worker.on("failed", (job, err) => {
  console.error(`Job ${job?.id} failed`, err);
});

console.log(`Worker listening on queue "${JOB_SEARCH_QUEUE}"`);
