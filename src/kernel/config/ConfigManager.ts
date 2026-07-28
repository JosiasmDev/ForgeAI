import { ForgeConfig, DEFAULT_CONFIG, IConfigManager, Unsubscribe } from './types';
import { IEventBus } from '../event-bus/types';

export class ConfigManager implements IConfigManager {
  private config: ForgeConfig = { ...DEFAULT_CONFIG };
  private keySubscribers = new Map<string, Set<(newVal: unknown, oldVal: unknown) => void>>();
  private globalSubscribers = new Set<(config: ForgeConfig) => void>();
  private eventBus?: IEventBus;
  private storageKey = 'forgeai_v4_config';

  constructor(eventBus?: IEventBus, storageKey = 'forgeai_v4_config') {
    this.eventBus = eventBus;
    this.storageKey = storageKey;
    this.loadFromStorage();
  }

  public get<K extends keyof ForgeConfig>(key: K): ForgeConfig[K] {
    return this.config[key];
  }

  public getAll(): Readonly<ForgeConfig> {
    return { ...this.config };
  }

  public set<K extends keyof ForgeConfig>(key: K, value: ForgeConfig[K]): void {
    const oldValue = this.config[key];
    if (oldValue === value) return;

    this.config[key] = value;
    this.persist();

    // Notify key subscribers
    const handlers = this.keySubscribers.get(key as string);
    if (handlers) {
      handlers.forEach((h) => h(value, oldValue));
    }

    // Notify global subscribers
    this.globalSubscribers.forEach((h) => h(this.getAll()));

    // Emit event
    if (this.eventBus) {
      this.eventBus.emit({
        type: 'Config.Changed',
        source: 'config-manager',
        projectId: '__system__',
        payload: { key, oldValue, newValue: value },
      });
    }
  }

  public setBatch(updates: Partial<ForgeConfig>): void {
    const changes: Array<{ key: keyof ForgeConfig; oldValue: unknown; newValue: unknown }> = [];

    for (const [k, v] of Object.entries(updates)) {
      const key = k as keyof ForgeConfig;
      const oldValue = this.config[key];
      if (oldValue !== v) {
        (this.config as Record<string, unknown>)[key] = v;
        changes.push({ key, oldValue, newValue: v });
      }
    }

    if (changes.length === 0) return;
    this.persist();

    // Trigger subscribers
    for (const change of changes) {
      const handlers = this.keySubscribers.get(change.key as string);
      if (handlers) {
        handlers.forEach((h) => h(change.newValue, change.oldValue));
      }
      if (this.eventBus) {
        this.eventBus.emit({
          type: 'Config.Changed',
          source: 'config-manager',
          projectId: '__system__',
          payload: change,
        });
      }
    }

    this.globalSubscribers.forEach((h) => h(this.getAll()));
  }

  public onChange<K extends keyof ForgeConfig>(
    key: K,
    handler: (newValue: ForgeConfig[K], oldValue: ForgeConfig[K]) => void
  ): Unsubscribe {
    const keyStr = key as string;
    if (!this.keySubscribers.has(keyStr)) {
      this.keySubscribers.set(keyStr, new Set());
    }
    const set = this.keySubscribers.get(keyStr)!;
    set.add(handler as (n: unknown, o: unknown) => void);

    return () => {
      set.delete(handler as (n: unknown, o: unknown) => void);
    };
  }

  public onAnyChange(handler: (config: ForgeConfig) => void): Unsubscribe {
    this.globalSubscribers.add(handler);
    return () => {
      this.globalSubscribers.delete(handler);
    };
  }

  public reset(): void {
    this.setBatch(DEFAULT_CONFIG);
  }

  public export(): string {
    return JSON.stringify(this.config, null, 2);
  }

  public import(json: string): void {
    try {
      const parsed = JSON.parse(json);
      this.setBatch(parsed);
    } catch (err) {
      throw new Error(`Invalid configuration JSON: ${(err as Error).message}`);
    }
  }

  private loadFromStorage(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem(this.storageKey);
        if (stored) {
          this.config = { ...DEFAULT_CONFIG, ...JSON.parse(stored) };
        }
      }
    } catch {
      // Fallback to defaults on storage failure
    }
  }

  private persist(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.storageKey, JSON.stringify(this.config));
      }
    } catch {
      // Ignore persistence error
    }
  }
}
