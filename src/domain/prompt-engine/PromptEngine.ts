import { IPromptEngine, BuiltPrompt } from './types';
import { Context } from '../context-engine/types';

export class PromptEngine implements IPromptEngine {
  public build(agentRole: string, taskTitle: string, taskInput: string, context: Context): BuiltPrompt {
    const systemPrompt = `Eres un agente de IA especializado en el rol de: ${agentRole}. 
Responde con código TypeScript estricto o estructura Markdown según corresponda. Evita introducciones innecesarias.`;

    const memorySnippet = context.memoryNodes.length ? `\n\nMemoria previa:\n${context.memoryNodes.join('\n')}` : '';

    const userPrompt = `## Tarea: ${taskTitle}\nInput: ${taskInput}${memorySnippet}\n\nContexto de archivos:\n${context.files
      .map((f) => `### ${f.path}\n\`\`\`${f.language}\n${f.content}\n\`\`\``)
      .join('\n')}`;

    return {
      systemPrompt,
      userPrompt,
      estimatedTokens: Math.floor((systemPrompt.length + userPrompt.length) / 4),
    };
  }
}
