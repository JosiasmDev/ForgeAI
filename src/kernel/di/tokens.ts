import { createToken } from './types';
import type { IEventBus } from '../event-bus/types';

export const TOKENS = {
  EventBus: createToken<IEventBus>('EventBus'),
  ConfigManager: createToken<unknown>('ConfigManager'),
  Scheduler: createToken<unknown>('Scheduler'),
  Logger: createToken<unknown>('Logger'),
  Storage: createToken<unknown>('Storage'),
  AIProvider: createToken<unknown>('AIProvider'),
  AgentRegistry: createToken<unknown>('AgentRegistry'),
  ToolRegistry: createToken<unknown>('ToolRegistry'),
  MemoryEngine: createToken<unknown>('MemoryEngine'),
  MissionEngine: createToken<unknown>('MissionEngine'),
  ProjectEngine: createToken<unknown>('ProjectEngine'),
  PermissionEngine: createToken<unknown>('PermissionEngine'),
  ContextEngine: createToken<unknown>('ContextEngine'),
  PromptEngine: createToken<unknown>('PromptEngine'),
  ModelRouter: createToken<unknown>('ModelRouter'),
};
