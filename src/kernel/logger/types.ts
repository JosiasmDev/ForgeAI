export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  module?: string;
  projectId?: string;
  taskId?: string;
  agentRole?: string;
  [key: string]: unknown;
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context: LogContext;
  error?: { name: string; message: string; stack?: string };
}

export interface LogFilter {
  level?: LogLevel;
  module?: string;
  projectId?: string;
  limit?: number;
}

export interface ILogger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, error?: Error, context?: LogContext): void;
  child(context: LogContext): ILogger;
  getEntries(filter?: LogFilter): LogEntry[];
}
