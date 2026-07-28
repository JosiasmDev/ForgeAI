export interface ForgeConfig {
  locale: string;
  theme: 'dark' | 'light' | 'auto';
  defaultModel: string;
  simulationMode: boolean;
  streamingEnabled: boolean;
  maxTokensPerRequest: number;
  temperature: number;
  autoApprove: boolean;
  taskTimeoutMs: number;
  maxRetries: number;
  maxConcurrentTasks: number;
  allowNetworkTools: boolean;
  allowFileSystemTools: boolean;
  sandboxMode: 'strict' | 'permissive';
  storageBackend: 'indexeddb' | 'localstorage' | 'remote';
  syncEnabled: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  sidebarCollapsed: boolean;
  editorFontSize: number;
}

export const DEFAULT_CONFIG: ForgeConfig = {
  locale: 'es',
  theme: 'dark',
  defaultModel: 'claude-sonnet-4-6',
  simulationMode: true,
  streamingEnabled: true,
  maxTokensPerRequest: 4096,
  temperature: 0.7,
  autoApprove: false,
  taskTimeoutMs: 60000,
  maxRetries: 2,
  maxConcurrentTasks: 5,
  allowNetworkTools: false,
  allowFileSystemTools: false,
  sandboxMode: 'strict',
  storageBackend: 'indexeddb',
  syncEnabled: false,
  logLevel: 'info',
  sidebarCollapsed: false,
  editorFontSize: 14,
};

export type Unsubscribe = () => void;

export interface IConfigManager {
  get<K extends keyof ForgeConfig>(key: K): ForgeConfig[K];
  getAll(): Readonly<ForgeConfig>;
  set<K extends keyof ForgeConfig>(key: K, value: ForgeConfig[K]): void;
  setBatch(updates: Partial<ForgeConfig>): void;
  onChange<K extends keyof ForgeConfig>(
    key: K,
    handler: (newValue: ForgeConfig[K], oldValue: ForgeConfig[K]) => void
  ): Unsubscribe;
  onAnyChange(handler: (config: ForgeConfig) => void): Unsubscribe;
  reset(): void;
  export(): string;
  import(json: string): void;
}
