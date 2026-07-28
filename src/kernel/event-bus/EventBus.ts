import { IEventBus, ForgeEvent, EventHandler, EventMiddleware, SubscribeOptions, EventFilter, Unsubscribe } from './types';

export function createUid(prefix = 'evt'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

interface ListenerEntry {
  handler: EventHandler;
  priority: number;
  once: boolean;
  filter?: (event: ForgeEvent) => boolean;
}

export class EventBus implements IEventBus {
  private listeners: Map<string, ListenerEntry[]> = new Map();
  private middlewares: EventMiddleware[] = [];
  private history: ForgeEvent[] = [];
  private maxHistorySize = 1000;

  constructor(maxHistorySize = 1000) {
    this.maxHistorySize = maxHistorySize;
  }

  public subscribe(eventType: string, handler: EventHandler, options: SubscribeOptions = {}): Unsubscribe {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, []);
    }

    const entry: ListenerEntry = {
      handler,
      priority: options.priority || 0,
      once: options.once || false,
      filter: options.filter,
    };

    const queue = this.listeners.get(eventType)!;
    queue.push(entry);
    // Sort by priority descending
    queue.sort((a, b) => b.priority - a.priority);

    return () => {
      const list = this.listeners.get(eventType);
      if (list) {
        this.listeners.set(eventType, list.filter((l) => l !== entry));
      }
    };
  }

  public once(eventType: string, handler: EventHandler): Unsubscribe {
    return this.subscribe(eventType, handler, { once: true });
  }

  public emit(event: ForgeEvent): ForgeEvent {
    const fullEvent: ForgeEvent = {
      ...event,
      id: event.id || createUid('evt'),
      timestamp: event.timestamp || new Date().toISOString(),
    };

    this.history.push(fullEvent);
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }

    const dispatch = (evt: ForgeEvent) => {
      // Execute specific handlers
      const specific = this.listeners.get(evt.type) || [];
      const remaining: ListenerEntry[] = [];

      for (const entry of specific) {
        if (!entry.filter || entry.filter(evt)) {
          try {
            entry.handler(evt);
          } catch (err) {
            console.error(`[EventBus] Error in handler for event ${evt.type}:`, err);
          }
        }
        if (!entry.once) {
          remaining.push(entry);
        }
      }
      this.listeners.set(evt.type, remaining);

      // Execute wildcard handlers (*)
      const wildcards = this.listeners.get('*') || [];
      const remainingWildcards: ListenerEntry[] = [];

      for (const entry of wildcards) {
        if (!entry.filter || entry.filter(evt)) {
          try {
            entry.handler(evt);
          } catch (err) {
            console.error(`[EventBus] Error in wildcard handler:`, err);
          }
        }
        if (!entry.once) {
          remainingWildcards.push(entry);
        }
      }
      this.listeners.set('*', remainingWildcards);
    };

    // Execute middleware chain
    const runMiddleware = (evt: ForgeEvent, index: number) => {
      if (index >= this.middlewares.length) {
        dispatch(evt);
      } else {
        try {
          this.middlewares[index](evt, (nextEvt) => runMiddleware(nextEvt || evt, index + 1));
        } catch (err) {
          console.error(`[EventBus] Error in middleware at index ${index}:`, err);
          dispatch(evt);
        }
      }
    };

    runMiddleware(fullEvent, 0);
    return fullEvent;
  }

  public use(middleware: EventMiddleware): void {
    this.middlewares.push(middleware);
  }

  public getHistory(filter?: EventFilter): ForgeEvent[] {
    let result = [...this.history];
    if (!filter) return result;

    if (filter.projectId) {
      result = result.filter((e) => e.projectId === filter.projectId);
    }
    if (filter.type) {
      result = result.filter((e) => e.type === filter.type);
    }
    if (filter.source) {
      result = result.filter((e) => e.source === filter.source);
    }
    if (filter.since) {
      const sinceTime = new Date(filter.since).getTime();
      result = result.filter((e) => e.timestamp && new Date(e.timestamp).getTime() >= sinceTime);
    }
    if (filter.limit && filter.limit > 0) {
      result = result.slice(-filter.limit);
    }

    return result;
  }

  public getStats(): Record<string, number> {
    const stats: Record<string, number> = {};
    for (const evt of this.history) {
      stats[evt.type] = (stats[evt.type] || 0) + 1;
    }
    return stats;
  }

  public clearHistory(): void {
    this.history = [];
  }
}
