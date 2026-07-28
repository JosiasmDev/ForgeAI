export interface ForgeEvent {
  type: string;
  source: string;
  projectId: string;
  payload: Record<string, unknown>;
  id?: string;
  timestamp?: string;
  correlationId?: string;
}

export type EventHandler = (event: ForgeEvent) => void | Promise<void>;
export type EventMiddleware = (event: ForgeEvent, next: (event?: ForgeEvent) => void) => void;
export type Unsubscribe = () => void;

export interface SubscribeOptions {
  priority?: number;
  once?: boolean;
  filter?: (event: ForgeEvent) => boolean;
}

export interface EventFilter {
  projectId?: string;
  type?: string;
  source?: string;
  since?: string;
  limit?: number;
}

export interface IEventBus {
  subscribe(eventType: string, handler: EventHandler, options?: SubscribeOptions): Unsubscribe;
  once(eventType: string, handler: EventHandler): Unsubscribe;
  emit(event: ForgeEvent): ForgeEvent;
  use(middleware: EventMiddleware): void;
  getHistory(filter?: EventFilter): ForgeEvent[];
  getStats(): Record<string, number>;
  clearHistory(): void;
}
