import { createToken } from './di/tokens';
import type { IScheduler } from './scheduler/types';
import type { IConfigManager } from './config/types';
import type { ILogger } from './logger/types';
import type { IErrorHandler } from './error-handler/types';

export const KERNEL_TOKENS = {
  Scheduler: createToken<IScheduler>('Scheduler'),
  ConfigManager: createToken<IConfigManager>('ConfigManager'),
  Logger: createToken<ILogger>('Logger'),
  ErrorHandler: createToken<IErrorHandler>('ErrorHandler'),
};
