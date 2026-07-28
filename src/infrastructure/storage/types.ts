export interface StorageFilter {
  where?: Record<string, unknown>;
  orderBy?: string;
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface StorageInfo {
  backend: string;
  usedBytes: number;
  availableBytes: number;
  collections: { name: string; count: number }[];
}

export interface IStorageTransaction {
  get<T>(collection: string, id: string): Promise<T | null>;
  put<T extends { id: string }>(collection: string, item: T): Promise<void>;
  delete(collection: string, id: string): Promise<void>;
}

export interface IStorageAdapter {
  init(): Promise<void>;
  get<T>(collection: string, id: string): Promise<T | null>;
  getAll<T>(collection: string, filter?: StorageFilter): Promise<T[]>;
  put<T extends { id: string }>(collection: string, item: T): Promise<void>;
  delete(collection: string, id: string): Promise<void>;
  clear(collection: string): Promise<void>;
  count(collection: string, filter?: StorageFilter): Promise<number>;
  putBatch<T extends { id: string }>(collection: string, items: T[]): Promise<void>;
  deleteBatch(collection: string, ids: string[]): Promise<void>;
  getCollections(): Promise<string[]>;
  getStorageInfo(): Promise<StorageInfo>;
}
