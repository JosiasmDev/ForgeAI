export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';

export class ForgeError extends Error {
  public code: string;
  public severity: ErrorSeverity;
  public context: Record<string, unknown>;
  public recoverable: boolean;
  public timestamp: string;

  constructor(
    message: string,
    code = 'UNKNOWN_ERROR',
    severity: ErrorSeverity = 'medium',
    context: Record<string, unknown> = {},
    recoverable = true
  ) {
    super(message);
    this.name = 'ForgeError';
    this.code = code;
    this.severity = severity;
    this.context = context;
    this.recoverable = recoverable;
    this.timestamp = new Date().toISOString();
  }
}

export type ErrorHandlerCallback = (error: ForgeError) => void;
export type Unsubscribe = () => void;

export interface IErrorHandler {
  handle(error: Error | ForgeError, context?: Record<string, unknown>): void;
  wrap<T extends (...args: unknown[]) => unknown>(fn: T, context?: Record<string, unknown>): T;
  wrapAsync<T>(promise: Promise<T>, context?: Record<string, unknown>): Promise<T>;
  onError(code: string, handler: ErrorHandlerCallback): Unsubscribe;
}
