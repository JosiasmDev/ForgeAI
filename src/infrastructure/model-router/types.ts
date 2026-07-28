import { AIRequest, AIResponse, StreamCallback } from '../ai-provider/types';

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  maxOutput: number;
  costPer1kInput: number;
  costPer1kOutput: number;
  supportsStreaming: boolean;
  supportsToolCalling: boolean;
  capabilities: string[];
}

export interface ModelSelectionCriteria {
  taskType: 'code_generation' | 'code_review' | 'planning' | 'analysis' | 'testing' | 'documentation' | 'general';
  complexity: 'low' | 'medium' | 'high';
  agentRole: string;
  preferredModel?: string;
  maxCost?: number;
  requiredCapabilities?: string[];
  contextSize?: number;
}

export interface ModelSelection {
  model: ModelInfo;
  reasoning: string;
}

export interface IModelRouter {
  selectModel(criteria: ModelSelectionCriteria): ModelSelection;
  getAvailableModels(): ModelInfo[];
  execute(request: AIRequest, criteria: ModelSelectionCriteria): Promise<AIResponse>;
  executeStream(request: AIRequest, criteria: ModelSelectionCriteria, onChunk: StreamCallback): Promise<AIResponse>;
}
