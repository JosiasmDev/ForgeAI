import { IAIProvider, AIRequest, AIResponse, StreamCallback } from './types';

export class AnthropicProvider implements IAIProvider {
  public readonly id = 'anthropic';
  public readonly name = 'Anthropic Claude Provider';
  private apiKey: string;

  constructor(apiKey = '') {
    this.apiKey = apiKey;
  }

  public setApiKey(key: string): void {
    this.apiKey = key;
  }

  public async execute(request: AIRequest): Promise<AIResponse> {
    const start = Date.now();
    if (!this.apiKey) {
      // Graceful fallback to simulation mode when API Key is missing
      return {
        content: `[Anthropic API Mock Response - No API Key Set] Output for model: ${request.model}`,
        model: request.model || 'claude-sonnet-4-6',
        provider: this.id,
        tokensUsed: { input: 120, output: 180, total: 300 },
        latencyMs: Date.now() - start,
        cost: 0.001,
        finishReason: 'stop',
      };
    }

    // Actual API invocation structure
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: request.model || 'claude-3-5-sonnet-20241022',
          system: request.systemPrompt,
          messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
          max_tokens: request.maxTokens || 4096,
        }),
      });

      const data = await response.json();
      const content = data.content?.[0]?.text || '';

      return {
        content,
        model: data.model || request.model,
        provider: this.id,
        tokensUsed: {
          input: data.usage?.input_tokens || 0,
          output: data.usage?.output_tokens || 0,
          total: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
        },
        latencyMs: Date.now() - start,
        cost: 0.003,
        finishReason: 'stop',
      };
    } catch (err) {
      throw new Error(`Anthropic Provider API Error: ${(err as Error).message}`);
    }
  }

  public async executeStream(request: AIRequest, onChunk: StreamCallback): Promise<AIResponse> {
    // Basic streaming fallback implementation
    const res = await this.execute(request);
    const words = res.content.split(' ');
    for (let i = 0; i < words.length; i += 3) {
      await new Promise((r) => setTimeout(r, 30));
      onChunk(words.slice(i, i + 3).join(' ') + ' ', false);
    }
    onChunk('', true);
    return res;
  }

  public async healthCheck(): Promise<boolean> {
    return !!this.apiKey;
  }
}
