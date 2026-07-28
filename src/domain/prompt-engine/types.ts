import { Context } from '../context-engine/types';

export interface BuiltPrompt {
  systemPrompt: string;
  userPrompt: string;
  estimatedTokens: number;
}

export interface IPromptEngine {
  build(agentRole: string, taskTitle: string, taskInput: string, context: Context): BuiltPrompt;
}
