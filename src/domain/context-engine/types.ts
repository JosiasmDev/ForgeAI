export interface ContextFile {
  path: string;
  content: string;
  language: string;
  relevanceScore: number;
}

export interface Context {
  projectId: string;
  files: ContextFile[];
  memoryNodes: string[];
  estimatedTokens: number;
}

export interface IContextEngine {
  buildContext(projectId: string, agentRole: string, taskInput: string): Promise<Context>;
  compress(context: Context, maxTokens: number): Context;
}
