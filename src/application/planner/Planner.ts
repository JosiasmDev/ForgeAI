import { IPlanner, ExecutionPlan } from './types';
import { IAIProvider } from '../../infrastructure/ai-provider/types';

export class Planner implements IPlanner {
  private aiProvider: IAIProvider;

  constructor(aiProvider: IAIProvider) {
    this.aiProvider = aiProvider;
  }

  public async plan(goal: string, contextDescription: string): Promise<ExecutionPlan> {
    const prompt = `Descompón el siguiente objetivo en tareas ordenadas para agentes de IA (product_manager, architect, developer):
Objetivo: ${goal}
Contexto: ${contextDescription}`;

    const response = await this.aiProvider.execute({
      model: 'default',
      systemPrompt: 'Eres un Planner experto. Devuelve un plan formal.',
      messages: [{ role: 'user', content: prompt }],
    });

    return {
      goal,
      reasoning: response.content,
      tasks: [
        {
          title: 'Validación Inicial',
          description: 'Validar producto y viabilidad técnica',
          agentRole: 'product_manager',
          input: goal,
        },
        {
          title: 'Arquitectura de Sistema',
          description: 'Diseñar Clean Arch + DDD',
          agentRole: 'architect',
          input: goal,
        },
        {
          title: 'Generación de Código',
          description: 'Implementación TypeScript',
          agentRole: 'developer',
          input: goal,
        },
      ],
    };
  }
}
