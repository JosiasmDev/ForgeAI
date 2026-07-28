import { IAIProvider, AIRequest, AIResponse, StreamCallback } from './types';

export class SimulationProvider implements IAIProvider {
  public readonly id = 'simulation';
  public readonly name = 'Simulation Provider';

  public async execute(request: AIRequest): Promise<AIResponse> {
    const start = Date.now();
    await new Promise((r) => setTimeout(r, 600));

    const content = `[Simulation AI Response]\nRole/System: ${request.systemPrompt.slice(
      0,
      100
    )}...\nProcessed Request: ${JSON.stringify(request.messages)}`;

    return {
      content,
      model: request.model || 'sim-model-v1',
      provider: this.id,
      tokensUsed: { input: 150, output: 200, total: 350 },
      latencyMs: Date.now() - start,
      cost: 0,
      finishReason: 'stop',
    };
  }

  public async executeStream(request: AIRequest, onChunk: StreamCallback): Promise<AIResponse> {
    const start = Date.now();
    const mockText = `[Streaming Simulation Output] Generación de código e inferencia completada para el modelo: ${request.model}`;
    const words = mockText.split(' ');

    for (let i = 0; i < words.length; i += 2) {
      await new Promise((r) => setTimeout(r, 40));
      const chunk = words.slice(i, i + 2).join(' ') + ' ';
      onChunk(chunk, false);
    }
    onChunk('', true);

    return {
      content: mockText,
      model: request.model || 'sim-model-v1',
      provider: this.id,
      tokensUsed: { input: 120, output: 180, total: 300 },
      latencyMs: Date.now() - start,
      cost: 0,
      finishReason: 'stop',
    };
  }

  public async healthCheck(): Promise<boolean> {
    return true;
  }
}
