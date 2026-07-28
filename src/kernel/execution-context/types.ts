import { ILogger } from '../logger/types';
import { IServiceRegistry } from '../di/types';
import { ForgeEvent } from '../event-bus/types';

export interface IExecutionContext {
  readonly id: string;
  readonly projectId: string;
  readonly missionId: string;
  readonly taskId: string;
  readonly agentRole: string;
  readonly startedAt: string;

  readonly log: ILogger;
  readonly events: ForgeEvent[];
  readonly services: IServiceRegistry;
  readonly signal: AbortSignal;
  metadata: Record<string, unknown>;
}

export interface CreateExecutionContextOptions {
  projectId: string;
  missionId: string;
  taskId: string;
  agentRole: string;
  parentServices: IServiceRegistry;
  parentLogger: ILogger;
  metadata?: Record<string, unknown>;
}
