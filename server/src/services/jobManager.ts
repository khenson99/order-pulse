// Job Manager - Background processing for email analysis
import { v4 as uuidv4 } from 'uuid';
import redisClient from '../utils/redisClient.js';

export interface JobProgress {
  total: number;
  processed: number;
  success: number;
  failed: number;
  currentTask: string;
}

export interface EmailPreview {
  id: string;
  subject: string;
  sender: string;
  snippet?: string;
}

export interface AmazonEnrichedData {
  asin: string;
  itemName?: string;
  humanizedName?: string;  // Shop-floor friendly name from LLM
  price?: string;
  imageUrl?: string;
  amazonUrl?: string;
  unitCount?: number;
  unitPrice?: number;
  upc?: string;
}

export interface ProcessedOrderItem {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  asin?: string;
  amazonEnriched?: AmazonEnrichedData;
}

export interface ProcessedOrder {
  id: string;
  supplier: string;
  orderDate: string;
  totalAmount: number;
  items: ProcessedOrderItem[];
  confidence: number;
}

export interface Job {
  id: string;
  userId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: JobProgress;
  currentEmail: EmailPreview | null;
  orders: ProcessedOrder[];
  logs: string[];
  createdAt: Date;
  updatedAt: Date;
  error?: string;
}

// In-memory job storage (would be Redis/DB in production)
const jobs = new Map<string, Job>();
const userJobs = new Map<string, string>(); // userId -> jobId (latest)
const jobPersistenceCache = new Map<string, string>();

const JOB_KEY_PREFIX = 'orderpulse:job:';
const USER_JOB_KEY = 'orderpulse:user';

function jobKey(jobId: string): string {
  return `${JOB_KEY_PREFIX}${jobId}`;
}

function serializeJob(job: Job) {
  return {
    ...job,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

function deserializeJob(payload: string): Job {
  const parsed = JSON.parse(payload);
  return {
    ...parsed,
    createdAt: new Date(parsed.createdAt),
    updatedAt: new Date(parsed.updatedAt),
  };
}

function persistJob(job: Job) {
  const payload = JSON.stringify(serializeJob(job));
  if (jobPersistenceCache.get(job.id) === payload) {
    return;
  }
  jobPersistenceCache.set(job.id, payload);

  if (!redisClient) return;
  redisClient.set(jobKey(job.id), payload).catch((err: Error) => {
    console.error('Failed to persist job to Redis:', err);
  });
}

function persistUserJob(userId: string, jobId: string) {
  if (!redisClient) return;
  redisClient.hset(USER_JOB_KEY, userId, jobId).catch((err: Error) => {
    console.error('Failed to persist user job mapping:', err);
  });
}

function cleanupRedisMapping(userId: string, jobId: string) {
  if (!redisClient) return;
  redisClient.hget(USER_JOB_KEY, userId).then((existing: string | null) => {
    if (existing === jobId) {
      return redisClient!.hdel(USER_JOB_KEY, userId);
    }
  }).catch((err: Error) => {
    console.error('Failed to clean up user job mapping:', err);
  });
}

export function createJob(userId: string): Job {
  // Cancel any existing running job for this user
  const existingJobId = userJobs.get(userId);
  if (existingJobId) {
    const existingJob = jobs.get(existingJobId);
    if (existingJob && existingJob.status === 'running') {
      existingJob.status = 'failed';
      existingJob.error = 'Cancelled - new job started';
      existingJob.updatedAt = new Date();
    }
  }

  const job: Job = {
    id: uuidv4(),
    userId,
    status: 'pending',
    progress: {
      total: 0,
      processed: 0,
      success: 0,
      failed: 0,
      currentTask: 'Queued...',
    },
    currentEmail: null,
    orders: [],
    logs: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  jobs.set(job.id, job);
  userJobs.set(userId, job.id);
  persistJob(job);
  persistUserJob(userId, job.id);

  return job;
}

export function getJob(jobId: string): Job | undefined {
  return jobs.get(jobId);
}

export function getJobForUser(userId: string): Job | undefined {
  const jobId = userJobs.get(userId);
  if (jobId) {
    return jobs.get(jobId);
  }
  return undefined;
}

export function updateJob(jobId: string, updates: Partial<Job>): Job | undefined {
  const job = jobs.get(jobId);
  if (!job) return undefined;

  Object.assign(job, updates, { updatedAt: new Date() });
  persistJob(job);
  return job;
}

export function addJobLog(jobId: string, message: string): void {
  const job = jobs.get(jobId);
  if (job) {
    const timestamp = new Date().toLocaleTimeString();
    job.logs.unshift(`[${timestamp}] ${message}`);
    job.updatedAt = new Date();
    // Keep only last 100 logs
    if (job.logs.length > 100) {
      job.logs = job.logs.slice(0, 100);
    }
    persistJob(job);
  }
}

export function addJobOrder(jobId: string, order: ProcessedOrder): void {
  const job = jobs.get(jobId);
  if (job) {
    job.orders.push(order);
    job.updatedAt = new Date();
    persistJob(job);
  }
}

export function setJobCurrentEmail(jobId: string, email: EmailPreview | null): void {
  const job = jobs.get(jobId);
  if (job) {
    job.currentEmail = email;
    job.updatedAt = new Date();
    persistJob(job);
  }
}

export function updateJobProgress(jobId: string, progress: Partial<JobProgress>): void {
  const job = jobs.get(jobId);
  if (job) {
    Object.assign(job.progress, progress);
    job.updatedAt = new Date();
    persistJob(job);
  }
}

// Cleanup old jobs (jobs older than 1 hour)
export function cleanupOldJobs(): void {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  for (const [jobId, job] of jobs.entries()) {
    if (job.updatedAt < oneHourAgo && job.status !== 'running') {
      jobs.delete(jobId);
      // Clean up user mapping if this was their latest job
      if (userJobs.get(job.userId) === jobId) {
        userJobs.delete(job.userId);
        cleanupRedisMapping(job.userId, jobId);
      }
      if (redisClient) {
        redisClient.del(jobKey(jobId)).catch((err: Error) => {
          console.error('Failed to remove job from Redis:', err);
        });
      }
    }
  }
}

// Run cleanup every 10 minutes
setInterval(cleanupOldJobs, 10 * 60 * 1000);

export const jobManager = {
  createJob,
  getJob,
  getJobForUser,
  updateJob,
  addJobLog,
  addJobOrder,
  setJobCurrentEmail,
  updateJobProgress,
  cleanupOldJobs,
};

export async function initializeJobManager(): Promise<void> {
  if (!redisClient) {
    console.log('⚠️ Redis unavailable – job store will remain in-memory only');
    return;
  }

  try {
    const keys = await redisClient.keys(`${JOB_KEY_PREFIX}*`);
    for (const key of keys) {
      const payload = await redisClient.get(key);
      if (!payload) continue;
      const job = deserializeJob(payload);
      jobs.set(job.id, job);
    }

    const userEntries = await redisClient.hgetall(USER_JOB_KEY);
    for (const [userId, jobId] of Object.entries(userEntries) as [string, string][]) {
      if (!jobs.has(jobId)) {
        await redisClient.hdel(USER_JOB_KEY, userId);
        continue;
      }
      userJobs.set(userId, jobId);
    }

    console.log(`✅ Job manager hydrated ${jobs.size} jobs from Redis`);
  } catch (error) {
    console.error('Failed to hydrate jobs from Redis:', error);
  }
}
