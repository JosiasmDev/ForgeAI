import { IErrorHandler, ForgeError, ErrorHandlerCallback, Unsubscribe } from './types';
import { IEventBus } from '../event-bus/types';
import { ILogger } from '../logger/types';

export class ErrorHandler implements IErrorHandler {
  private handlers = new Map<string, Set<ErrorHandlerCallback>>();
  private eventBus?: IEventBus;
  private logger?: ILogger;

  constructor(eventBus?: IEventBus, logger?: ILogger) {
    this.eventBus = eventBus;
    this.logger = logger;
  }

  public handle(error: Error | ForgeError, context: Record<string, unknown> = {}): void {
    const forgeErr =
      error instanceof ForgeError
        ? error
        : new ForgeError(error.message, 'UNHANDLED_EXCEPTION', 'high', { ...context, originalName: error.name });

    // Log the error
    if (this.logger) {
      this.logger.error(`[ErrorHandler] ${forgeErr.code}: ${forgeErr.message}`, forgeErr, forgeErr.context);
    }

    // Emit event
    if (this.eventBus) {
      this.eventBus.emit({
        type: 'System.Error',
        source: 'error-handler',
        projectId: (forgeErr.context.projectId as string) || '__system__',
        payload: {
          code: forgeErr.code,
          message: forgeErr.message,
          severity: forgeErr.severity,
          context: forgeErr.context,
          recoverable: forgeErr.recoverable,
          timestamp: forgeErr.timestamp,
        },
      });
    }

    // Dispatch specific code handlers
    const specific = this.handlers.get(forgeErr.code);
    if (specific) {
      specific.forEach((fn) => {
        try {
          fn(forgeErr);
        } catch (hErr) {
          console.error(`[ErrorHandler] Error in error callback for code ${forgeErr.code}:`, hErr);
        }
      });
    }
  }

  public wrap<T extends (...args: unknown[]) => unknown>(fn: T, context: Record<string, unknown> = {}): T {
    return ((...args: unknown[]) => {
      try {
        const res = fn(...args);
        if (res instanceof Promise) {
          return res.catch((err) => {
            this.handle(err, context);
            throw err;
          });
        }
        return res;
      } catch (err) {
        this.handle(err as Error, context);
        throw err;
      }
    }) as T;
  }

  public wrapAsync<T>(promise: Promise<T>, context: Record<string, unknown> = {}): Promise<T> {
    return promise.catch((err) => {
      this.handle(err, context);
      throw err;
    });
  }

  public onError(code: string, handler: ErrorHandlerCallback): Unsubscribe {
    if (!this.handlers.has(code)) {
      this.handlers.set(code, new Set());
    }
    const set = this.handlers.get(code)!;
    set.add(handler);

    return () => {
      set.delete(handler);
    };
  }
}
