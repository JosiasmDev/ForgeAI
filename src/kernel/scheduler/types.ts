export type Priority = 'critical' | 'high' | 'medium' | 'low';
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface Job<T = unknown> {
  id?: string;
  fn: (signal: AbortSignal) => Promise<T>;
  priority?: Priority;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  group?: string;
  metadata?: Record<string, unknown>;
}

export interface SchedulerStats {
  running: number;
  queued: { critical: number; high: number; medium: number; low: number };
  completed: number;
  failed: number;
  cancelled: number;
}

export interface IScheduler {
  enqueue<T>(job: Job<T>): Promise<T>;
  cancel(jobId: string): boolean;
  getJobStatus(jobId: string): JobStatus | null;
  stats(): SchedulerStats;
  pause(): void;
  resume(): void;
}
