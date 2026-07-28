import { EventBus } from './event-bus/EventBus';
import { ServiceRegistry } from './di/ServiceRegistry';
import { Scheduler } from './scheduler/Scheduler';
import { ConfigManager } from './config/ConfigManager';
import { Logger } from './logger/Logger';
import { ErrorHandler } from './error-handler/ErrorHandler';

import { TOKENS } from './di/tokens';
import { KERNEL_TOKENS } from './tokens';

import { IEventBus } from './event-bus/types';
import { IServiceRegistry } from './di/types';
import { IScheduler } from './scheduler/types';
import { IConfigManager } from './config/types';
import { ILogger } from './logger/types';
import { IErrorHandler } from './error-handler/types';
import { ExecutionContext } from './execution-context/ExecutionContext';

export interface KernelBootOptions {
  maxHistorySize?: number;
  maxConcurrentJobs?: number;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

export class Kernel {
  public readonly eventBus: IEventBus;
  public readonly services: IServiceRegistry;
  public readonly scheduler: IScheduler;
  public readonly config: IConfigManager;
  public readonly logger: ILogger;
  public readonly errorHandler: IErrorHandler;

  constructor(options: KernelBootOptions = {}) {
    this.eventBus = new EventBus(options.maxHistorySize || 1000);
    this.services = new ServiceRegistry();
    this.logger = new Logger({ module: 'Kernel' }, options.logLevel || 'info');
    this.config = new ConfigManager(this.eventBus);
    this.scheduler = new Scheduler(options.maxConcurrentJobs || 5);
    this.errorHandler = new ErrorHandler(this.eventBus, this.logger);

    this.registerCoreServices();
  }

  private registerCoreServices(): void {
    this.services.register(TOKENS.EventBus, () => this.eventBus);
    this.services.register(KERNEL_TOKENS.ConfigManager, () => this.config);
    this.services.register(KERNEL_TOKENS.Scheduler, () => this.scheduler);
    this.services.register(KERNEL_TOKENS.Logger, () => this.logger);
    this.services.register(KERNEL_TOKENS.ErrorHandler, () => this.errorHandler);
  }

  public createExecutionContext(params: {
    projectId: string;
    missionId: string;
    taskId: string;
    agentRole: string;
    metadata?: Record<string, unknown>;
  }): ExecutionContext {
    return new ExecutionContext({
      ...params,
      parentServices: this.services,
      parentLogger: this.logger,
    });
  }

  public boot(): void {
    this.logger.info('Booting Kernel v4.0...');

    this.eventBus.emit({
      type: 'System.Booted',
      source: 'kernel',
      projectId: '__system__',
      payload: {
        timestamp: new Date().toISOString(),
        version: '4.0.0',
        modules: ['EventBus', 'ServiceRegistry', 'Scheduler', 'ConfigManager', 'Logger', 'ErrorHandler'],
      },
    });

    this.logger.info('Kernel v4.0 booted successfully.');
  }
}
