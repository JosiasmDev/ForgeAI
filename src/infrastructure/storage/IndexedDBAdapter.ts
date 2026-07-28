import { IStorageAdapter, StorageFilter, StorageInfo } from './types';

export class IndexedDBAdapter implements IStorageAdapter {
  private dbName: string;
  private version: number;
  private db: IDBDatabase | null = null;

  constructor(dbName = 'ForgeAI_v4_DB', version = 1) {
    this.dbName = dbName;
    this.version = version;
  }

  public async init(): Promise<void> {
    if (typeof indexedDB === 'undefined') return;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (e: IDBVersionChangeEvent) => {
        const db = (e.target as IDBOpenDBRequest).result;
        const stores = ['projects', 'missions', 'memory_nodes', 'config', 'agent_configs', 'audit_logs'];

        stores.forEach((s) => {
          if (!db.objectStoreNames.contains(s)) {
            db.createObjectStore(s, { keyPath: 'id' });
          }
        });
      };
    });
  }

  private getStore(collection: string, mode: IDBTransactionMode): IDBObjectStore {
    if (!this.db) throw new Error('IndexedDB not initialized');
    if (!this.db.objectStoreNames.contains(collection)) {
      throw new Error(`Collection ${collection} does not exist`);
    }
    const tx = this.db.transaction(collection, mode);
    return tx.objectStore(collection);
  }

  public async get<T>(collection: string, id: string): Promise<T | null> {
    if (!this.db) return null;
    return new Promise((resolve, reject) => {
      try {
        const store = this.getStore(collection, 'readonly');
        const req = store.get(id);
        req.onsuccess = () => resolve((req.result as T) || null);
        req.onerror = () => reject(req.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  public async getAll<T>(collection: string, filter?: StorageFilter): Promise<T[]> {
    if (!this.db) return [];
    return new Promise((resolve, reject) => {
      try {
        const store = this.getStore(collection, 'readonly');
        const req = store.getAll();
        req.onsuccess = () => {
          let items = (req.result as T[]) || [];
          if (filter?.where) {
            items = items.filter((item) => {
              for (const [k, v] of Object.entries(filter.where!)) {
                if ((item as Record<string, unknown>)[k] !== v) return false;
              }
              return true;
            });
          }
          if (filter?.offset) items = items.slice(filter.offset);
          if (filter?.limit) items = items.slice(0, filter.limit);
          resolve(items);
        };
        req.onerror = () => reject(req.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  public async put<T extends { id: string }>(collection: string, item: T): Promise<void> {
    if (!this.db) return;
    return new Promise((resolve, reject) => {
      try {
        const store = this.getStore(collection, 'readwrite');
        const req = store.put(item);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  public async delete(collection: string, id: string): Promise<void> {
    if (!this.db) return;
    return new Promise((resolve, reject) => {
      try {
        const store = this.getStore(collection, 'readwrite');
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  public async clear(collection: string): Promise<void> {
    if (!this.db) return;
    return new Promise((resolve, reject) => {
      try {
        const store = this.getStore(collection, 'readwrite');
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  public async count(collection: string, filter?: StorageFilter): Promise<number> {
    const items = await this.getAll(collection, filter);
    return items.length;
  }

  public async putBatch<T extends { id: string }>(collection: string, items: T[]): Promise<void> {
    for (const item of items) {
      await this.put(collection, item);
    }
  }

  public async deleteBatch(collection: string, ids: string[]): Promise<void> {
    for (const id of ids) {
      await this.delete(collection, id);
    }
  }

  public async getCollections(): Promise<string[]> {
    if (!this.db) return [];
    return Array.from(this.db.objectStoreNames);
  }

  public async getStorageInfo(): Promise<StorageInfo> {
    const cols = await this.getCollections();
    const counts = await Promise.all(
      cols.map(async (c) => ({
        name: c,
        count: await this.count(c),
      }))
    );
    return {
      backend: 'indexeddb',
      usedBytes: 0,
      availableBytes: Number.MAX_SAFE_INTEGER,
      collections: counts,
    };
  }
}
