export interface AIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
}

export interface AIRequest {
  model: string;
  systemPrompt: string;
  messages: AIMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'text' | 'json';
}

export interface AIResponse {
  content: string;
  model: string;
  provider: string;
  tokensUsed: { input: number; output: number; total: number };
  latencyMs: number;
  cost: number;
  finishReason: 'stop' | 'length' | 'error';
}

export type StreamCallback = (delta: string, done: boolean) => void;

export interface IAIProvider {
  readonly id: string;
  readonly name: string;
  execute(request: AIRequest): Promise<AIResponse>;
  executeStream(request: AIRequest, onChunk: StreamCallback): Promise<AIResponse>;
  healthCheck(): Promise<boolean>;
}
