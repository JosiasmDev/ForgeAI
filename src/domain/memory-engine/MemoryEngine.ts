import { IMemoryEngine, MemoryNode } from './types';
import { IStorageAdapter } from '../../infrastructure/storage/types';

export class MemoryEngine implements IMemoryEngine {
  private storage: IStorageAdapter;

  constructor(storage: IStorageAdapter) {
    this.storage = storage;
  }

  public async store(node: MemoryNode): Promise<void> {
    await this.storage.put('memory_nodes', node);
  }

  public async retrieve(projectId: string, agentRole: string): Promise<MemoryNode[]> {
    const all = await this.storage.getAll<MemoryNode>('memory_nodes', {
      where: { projectId },
    });

    // Basic affinity filter
    return all.filter((n) => n.confidence > 0.5 && n.sourceAgent === agentRole).slice(0, 10);
  }

  public async getGlobalNodes(): Promise<MemoryNode[]> {
    return this.storage.getAll<MemoryNode>('memory_nodes', {
      where: { projectId: '__global__' },
    });
  }
}
