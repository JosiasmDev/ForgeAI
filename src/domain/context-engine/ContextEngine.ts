import { IContextEngine, Context } from './types';
import { IMemoryEngine } from '../memory-engine/types';

export class ContextEngine implements IContextEngine {
  private memoryEngine: IMemoryEngine;

  constructor(memoryEngine: IMemoryEngine) {
    this.memoryEngine = memoryEngine;
  }

  public async buildContext(projectId: string, agentRole: string, taskInput: string): Promise<Context> {
    const nodes = await this.memoryEngine.retrieve(projectId, agentRole);

    return {
      projectId,
      files: [
        {
          path: 'src/main.tsx',
          content: `// Main context snippet for ${taskInput.slice(0, 30)}`,
          language: 'typescript',
          relevanceScore: 0.95,
        },
      ],
      memoryNodes: nodes.map((n) => `${n.title}: ${n.content}`),
      estimatedTokens: 350,
    };
  }

  public compress(context: Context, maxTokens: number): Context {
    if (context.estimatedTokens <= maxTokens) return context;
    return {
      ...context,
      files: context.files.slice(0, 1),
      estimatedTokens: maxTokens,
    };
  }
}
