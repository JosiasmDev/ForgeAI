export interface MemoryNode {
  id: string;
  type: 'decision' | 'requirement' | 'error' | 'learning';
  title: string;
  content: string;
  sourceAgent: string;
  projectId: string;
  timestamp: string;
  confidence: number;
}

export interface IMemoryEngine {
  retrieve(projectId: string, agentRole: string): Promise<MemoryNode[]>;
  store(node: MemoryNode): Promise<void>;
  getGlobalNodes(): Promise<MemoryNode[]>;
}
