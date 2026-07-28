import { IExecutionContext, CreateExecutionContextOptions } from './types';
import { ILogger } from '../logger/types';
import { IServiceRegistry } from '../di/types';
import { ForgeEvent } from '../event-bus/types';
import { createUid } from '../event-bus/EventBus';

export class ExecutionContext implements IExecutionContext {
  public readonly id: string;
  public readonly projectId: string;
  public readonly missionId: string;
  public readonly taskId: string;
  public readonly agentRole: string;
  public readonly startedAt: string;

  public readonly log: ILogger;
  public readonly events: ForgeEvent[] = [];
  public readonly services: IServiceRegistry;

  private abortController: AbortController;
  public metadata: Record<string, unknown>;

  constructor(options: CreateExecutionContextOptions) {
    this.id = createUid('ctx');
    this.projectId = options.projectId;
    this.missionId = options.missionId;
    this.taskId = options.taskId;
    this.agentRole = options.agentRole;
    this.startedAt = new Date().toISOString();
    this.metadata = options.metadata || {};

    this.abortController = new AbortController();

    this.log = options.parentLogger.child({
      module: 'ExecutionContext',
      projectId: this.projectId,
      missionId: this.missionId,
      taskId: this.taskId,
      agentRole: this.agentRole,
    });

    this.services = options.parentServices.createScope();
  }

  public get signal(): AbortSignal {
    return this.abortController.signal;
  }

  public abort(reason?: string): void {
    this.abortController.abort(reason);
    this.log.warn(`ExecutionContext aborted: ${reason || 'no reason provided'}`);
  }

  public recordEvent(event: ForgeEvent): void {
    this.events.push(event);
  }
}
