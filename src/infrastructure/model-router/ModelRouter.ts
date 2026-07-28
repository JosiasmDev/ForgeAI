import { IModelRouter, ModelInfo, ModelSelection, ModelSelectionCriteria } from './types';
import { IAIProvider, AIRequest, AIResponse, StreamCallback } from '../ai-provider/types';

export class ModelRouter implements IModelRouter {
  private providers = new Map<string, IAIProvider>();
  private models: ModelInfo[] = [
    {
      id: 'claude-sonnet-4-6',
      name: 'Claude Sonnet 4.6',
      provider: 'simulation',
      contextWindow: 200000,
      maxOutput: 4096,
      costPer1kInput: 0.003,
      costPer1kOutput: 0.015,
      supportsStreaming: true,
      supportsToolCalling: true,
      capabilities: ['code', 'reasoning', 'analysis'],
    },
    {
      id: 'gpt-4o',
      name: 'GPT-4o',
      provider: 'simulation',
      contextWindow: 128000,
      maxOutput: 4096,
      costPer1kInput: 0.0025,
      costPer1kOutput: 0.01,
      supportsStreaming: true,
      supportsToolCalling: true,
      capabilities: ['code', 'fast'],
    },
  ];

  constructor(defaultProvider: IAIProvider) {
    this.providers.set(defaultProvider.id, defaultProvider);
  }

  public registerProvider(provider: IAIProvider): void {
    this.providers.set(provider.id, provider);
  }

  public selectModel(criteria: ModelSelectionCriteria): ModelSelection {
    if (criteria.preferredModel) {
      const match = this.models.find((m) => m.id === criteria.preferredModel);
      if (match) {
        return { model: match, reasoning: `Preferred model explicitly selected: ${match.name}` };
      }
    }

    // Default intelligent selection
    const selected = this.models[0];
    return {
      model: selected,
      reasoning: `Selected default high-performance model ${selected.name} for task ${criteria.taskType}`,
    };
  }

  public getAvailableModels(): ModelInfo[] {
    return [...this.models];
  }

  public async execute(request: AIRequest, criteria: ModelSelectionCriteria): Promise<AIResponse> {
    const selection = this.selectModel(criteria);
    const provider = this.providers.get(selection.model.provider) || Array.from(this.providers.values())[0];
    return provider.execute({ ...request, model: selection.model.id });
  }

  public async executeStream(
    request: AIRequest,
    criteria: ModelSelectionCriteria,
    onChunk: StreamCallback
  ): Promise<AIResponse> {
    const selection = this.selectModel(criteria);
    const provider = this.providers.get(selection.model.provider) || Array.from(this.providers.values())[0];
    return provider.executeStream({ ...request, model: selection.model.id }, onChunk);
  }
}
