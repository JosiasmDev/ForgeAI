import { IStorageAdapter, StorageFilter, StorageInfo } from './types';

export class MemoryAdapter implements IStorageAdapter {
  private collections = new Map<string, Map<string, unknown>>();

  public async init(): Promise<void> {
    // Memory adapter is instantly ready
  }

  public async get<T>(collection: string, id: string): Promise<T | null> {
    const col = this.collections.get(collection);
    if (!col) return null;
    const val = col.get(id);
    return val ? (JSON.parse(JSON.stringify(val)) as T) : null;
  }

  public async getAll<T>(collection: string, filter?: StorageFilter): Promise<T[]> {
    const col = this.collections.get(collection);
    if (!col) return [];
    let items = Array.from(col.values()) as T[];

    if (filter?.where) {
      items = items.filter((item) => {
        for (const [k, v] of Object.entries(filter.where!)) {
          if ((item as Record<string, unknown>)[k] !== v) return false;
        }
        return true;
      });
    }

    if (filter?.offset) {
      items = items.slice(filter.offset);
    }
    if (filter?.limit) {
      items = items.slice(0, filter.limit);
    }

    return JSON.parse(JSON.stringify(items));
  }

  public async put<T extends { id: string }>(collection: string, item: T): Promise<void> {
    if (!this.collections.has(collection)) {
      this.collections.set(collection, new Map());
    }
    this.collections.get(collection)!.set(item.id, JSON.parse(JSON.stringify(item)));
  }

  public async delete(collection: string, id: string): Promise<void> {
    const col = this.collections.get(collection);
    if (col) {
      col.delete(id);
    }
  }

  public async clear(collection: string): Promise<void> {
    const col = this.collections.get(collection);
    if (col) {
      col.clear();
    }
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
    return Array.from(this.collections.keys());
  }

  public async getStorageInfo(): Promise<StorageInfo> {
    const collections = Array.from(this.collections.entries()).map(([name, col]) => ({
      name,
      count: col.size,
    }));
    return {
      backend: 'memory',
      usedBytes: 0,
      availableBytes: Number.MAX_SAFE_INTEGER,
      collections,
    };
  }
}
