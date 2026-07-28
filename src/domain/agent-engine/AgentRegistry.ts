import { IAgentRegistry, AgentDefinition } from './types';

export class AgentRegistry implements IAgentRegistry {
  private agents = new Map<string, AgentDefinition>();

  constructor() {
    this.registerDefaults();
  }

  public register(agent: AgentDefinition): void {
    this.agents.set(agent.role, agent);
  }

  public getByRole(role: string): AgentDefinition | null {
    return this.agents.get(role) || null;
  }

  public getAll(): AgentDefinition[] {
    return Array.from(this.agents.values());
  }

  public getEnabled(): AgentDefinition[] {
    return this.getAll().filter((a) => a.enabled);
  }

  private registerDefaults(): void {
    const defaults: AgentDefinition[] = [
      {
        id: 'agent_pm',
        role: 'product_manager',
        name: 'ProductManager',
        description: 'Valida ideas y define estrategia de producto.',
        personality: 'Riguroso, honesto, orientado a datos.',
        enabled: true,
        skills: [{ id: 'sk_m', name: 'Market Analysis', category: 'analysis' }],
        tools: ['memory', 'search'],
        systemPrompt: 'Eres un Product Manager experto. Responde en Markdown.',
      },
      {
        id: 'agent_arch',
        role: 'architect',
        name: 'Architect',
        description: 'Diseña arquitecturas técnicas escalables.',
        personality: 'Metódico, pragmático, evita sobre-ingeniería.',
        enabled: true,
        skills: [{ id: 'sk_s', name: 'System Design', category: 'planning' }],
        tools: ['memory', 'code_editor', 'filesystem'],
        systemPrompt: 'Eres un Arquitecto Senior. Diseña soluciones limpias.',
      },
      {
        id: 'agent_dev',
        role: 'developer',
        name: 'Developer',
        description: 'Implementa código TypeScript de alta calidad.',
        personality: 'SOLID, Clean Code, TypeScript strict.',
        enabled: true,
        skills: [{ id: 'sk_c', name: 'Code Generation', category: 'generation' }],
        tools: ['memory', 'filesystem', 'code_editor', 'terminal'],
        systemPrompt: 'Eres un Desarrollador Full-Stack Senior. Código limpio.',
      },
    ];

    defaults.forEach((a) => this.register(a));
  }
}
