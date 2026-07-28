import { ILogger, LogContext, LogEntry, LogFilter, LogLevel } from './types';

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger implements ILogger {
  private baseContext: LogContext;
  private entries: LogEntry[];
  private minLevel: LogLevel;
  private maxEntries: number;

  constructor(context: LogContext = {}, minLevel: LogLevel = 'info', maxEntries = 500, entriesStore?: LogEntry[]) {
    this.baseContext = context;
    this.minLevel = minLevel;
    this.maxEntries = maxEntries;
    this.entries = entriesStore || [];
  }

  public setMinLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  public debug(message: string, context?: LogContext): void {
    this.log('debug', message, context);
  }

  public info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }

  public warn(message: string, context?: LogContext): void {
    this.log('warn', message, context);
  }

  public error(message: string, error?: Error, context?: LogContext): void {
    const errObj = error
      ? {
          name: error.name,
          message: error.message,
          stack: error.stack,
        }
      : undefined;

    this.log('error', message, context, errObj);
  }

  public child(context: LogContext): ILogger {
    return new Logger(
      { ...this.baseContext, ...context },
      this.minLevel,
      this.maxEntries,
      this.entries
    );
  }

  public getEntries(filter?: LogFilter): LogEntry[] {
    let result = [...this.entries];
    if (!filter) return result;

    if (filter.level) {
      const minVal = LOG_LEVEL_ORDER[filter.level];
      result = result.filter((e) => LOG_LEVEL_ORDER[e.level] >= minVal);
    }
    if (filter.module) {
      result = result.filter((e) => e.context.module === filter.module);
    }
    if (filter.projectId) {
      result = result.filter((e) => e.context.projectId === filter.projectId);
    }
    if (filter.limit && filter.limit > 0) {
      result = result.slice(-filter.limit);
    }

    return result;
  }

  private log(
    level: LogLevel,
    message: string,
    context?: LogContext,
    errorObj?: { name: string; message: string; stack?: string }
  ): void {
    if (LOG_LEVEL_ORDER[level] < LOG_LEVEL_ORDER[this.minLevel]) return;

    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      context: { ...this.baseContext, ...context },
      error: errorObj,
    };

    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }

    // Optional console output formatting
    const prefix = `[${entry.timestamp}] [${level.toUpperCase()}]${
      entry.context.module ? ` [${entry.context.module}]` : ''
    }`;

    if (level === 'error') {
      console.error(prefix, message, entry.context, errorObj || '');
    } else if (level === 'warn') {
      console.warn(prefix, message, entry.context);
    } else {
      console.log(prefix, message, entry.context);
    }
  }
}
