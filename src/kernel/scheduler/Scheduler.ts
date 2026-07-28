import { IScheduler, Job, JobStatus, Priority, SchedulerStats } from './types';
import { createUid } from '../event-bus/EventBus';

interface InternalJob<T> {
  id: string;
  job: Job<T>;
  priority: Priority;
  status: JobStatus;
  controller: AbortController;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
  retriesLeft: number;
}

export class Scheduler implements IScheduler {
  private queues: Record<Priority, InternalJob<unknown>[]> = {
    critical: [],
    high: [],
    medium: [],
    low: [],
  };

  private runningJobs = new Map<string, InternalJob<unknown>>();
  private jobStatuses = new Map<string, JobStatus>();

  private maxConcurrent = 5;
  private isPaused = false;

  private completedCount = 0;
  private failedCount = 0;
  private cancelledCount = 0;

  constructor(maxConcurrent = 5) {
    this.maxConcurrent = maxConcurrent;
  }

  public enqueue<T>(job: Job<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const jobId = job.id || createUid('job');
      const priority = job.priority || 'medium';

      const internal: InternalJob<T> = {
        id: jobId,
        job,
        priority,
        status: 'queued',
        controller: new AbortController(),
        resolve,
        reject,
        retriesLeft: job.retries ?? 0,
      };

      this.jobStatuses.set(jobId, 'queued');
      this.queues[priority].push(internal as InternalJob<unknown>);

      this.processQueue();
    });
  }

  public cancel(jobId: string): boolean {
    // Check if running
    const running = this.runningJobs.get(jobId);
    if (running) {
      running.controller.abort();
      running.status = 'cancelled';
      this.runningJobs.delete(jobId);
      this.jobStatuses.set(jobId, 'cancelled');
      this.cancelledCount++;
      running.reject(new Error(`Job ${jobId} cancelled`));
      this.processQueue();
      return true;
    }

    // Check in queues
    for (const p of ['critical', 'high', 'medium', 'low'] as Priority[]) {
      const idx = this.queues[p].findIndex((j) => j.id === jobId);
      if (idx !== -1) {
        const [job] = this.queues[p].splice(idx, 1);
        job.status = 'cancelled';
        this.jobStatuses.set(jobId, 'cancelled');
        this.cancelledCount++;
        job.reject(new Error(`Job ${jobId} cancelled`));
        return true;
      }
    }

    return false;
  }

  public getJobStatus(jobId: string): JobStatus | null {
    return this.jobStatuses.get(jobId) || null;
  }

  public stats(): SchedulerStats {
    return {
      running: this.runningJobs.size,
      queued: {
        critical: this.queues.critical.length,
        high: this.queues.high.length,
        medium: this.queues.medium.length,
        low: this.queues.low.length,
      },
      completed: this.completedCount,
      failed: this.failedCount,
      cancelled: this.cancelledCount,
    };
  }

  public pause(): void {
    this.isPaused = true;
  }

  public resume(): void {
    this.isPaused = false;
    this.processQueue();
  }

  private processQueue(): void {
    if (this.isPaused) return;
    if (this.runningJobs.size >= this.maxConcurrent) return;

    const nextJob = this.popNextJob();
    if (!nextJob) return;

    this.runningJobs.set(nextJob.id, nextJob);
    nextJob.status = 'running';
    this.jobStatuses.set(nextJob.id, 'running');

    this.executeJob(nextJob);

    // Try processing next concurrent slots
    this.processQueue();
  }

  private popNextJob(): InternalJob<unknown> | null {
    const priorities: Priority[] = ['critical', 'high', 'medium', 'low'];
    for (const p of priorities) {
      if (this.queues[p].length > 0) {
        return this.queues[p].shift()!;
      }
    }
    return null;
  }

  private async executeJob(internal: InternalJob<unknown>): Promise<void> {
    const timeout = internal.job.timeout || 60000;
    let timer: NodeJS.Timeout | null = null;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        internal.controller.abort();
        reject(new Error(`Job ${internal.id} timed out after ${timeout}ms`));
      }, timeout);
    });

    try {
      const result = await Promise.race([
        internal.job.fn(internal.controller.signal),
        timeoutPromise,
      ]);

      if (timer) clearTimeout(timer);

      internal.status = 'completed';
      this.jobStatuses.set(internal.id, 'completed');
      this.completedCount++;
      internal.resolve(result);
    } catch (err) {
      if (timer) clearTimeout(timer);

      if (internal.retriesLeft > 0 && internal.status !== 'cancelled') {
        internal.retriesLeft--;
        const delay = internal.job.retryDelay || 1000;
        await new Promise((r) => setTimeout(r, delay));
        this.queues[internal.priority].unshift(internal);
      } else {
        internal.status = 'failed';
        this.jobStatuses.set(internal.id, 'failed');
        this.failedCount++;
        internal.reject(err);
      }
    } finally {
      this.runningJobs.delete(internal.id);
      this.processQueue();
    }
  }
}
