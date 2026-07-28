import { IExecutionContext } from '../../kernel/execution-context/types';

export interface ToolResult {
  success: boolean;
  output: string;
  duration: number;
  toolId: string;
  error?: string;
}

export interface ToolDefinition {
  id: string;
  name: string;
  category: string;
  description: string;
  permissions: string[];
  timeout: number;
  maxRetries: number;
  validate(params: Record<string, unknown>): { valid: boolean; errors: string[] };
  execute(params: Record<string, unknown>, context: IExecutionContext): Promise<ToolResult>;
}

export interface IToolRegistry {
  register(tool: ToolDefinition): void;
  get(toolId: string): ToolDefinition | null;
  getAll(): ToolDefinition[];
  execute(toolId: string, params: Record<string, unknown>, context: IExecutionContext): Promise<ToolResult>;
}
