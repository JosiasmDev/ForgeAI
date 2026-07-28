import { IToolRegistry, ToolDefinition, ToolResult } from './types';
import { IExecutionContext } from '../../kernel/execution-context/types';

export class ToolRegistry implements IToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  public register(tool: ToolDefinition): void {
    this.tools.set(tool.id, tool);
  }

  public get(toolId: string): ToolDefinition | null {
    return this.tools.get(toolId) || null;
  }

  public getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  public async execute(
    toolId: string,
    params: Record<string, unknown>,
    context: IExecutionContext
  ): Promise<ToolResult> {
    const tool = this.tools.get(toolId);
    if (!tool) {
      return {
        success: false,
        output: '',
        duration: 0,
        toolId,
        error: `Tool not found: ${toolId}`,
      };
    }

    const validation = tool.validate(params);
    if (!validation.valid) {
      return {
        success: false,
        output: '',
        duration: 0,
        toolId,
        error: `Validation failed: ${validation.errors.join(', ')}`,
      };
    }

    const start = Date.now();
    try {
      const result = await tool.execute(params, context);
      return {
        ...result,
        duration: Date.now() - start,
      };
    } catch (err) {
      return {
        success: false,
        output: '',
        duration: Date.now() - start,
        toolId,
        error: (err as Error).message,
      };
    }
  }
}
