export interface AgentSkill {
  id: string;
  name: string;
  category: string;
}

export interface AgentDefinition {
  id: string;
  role: string;
  name: string;
  description: string;
  personality: string;
  enabled: boolean;
  skills: AgentSkill[];
  tools: string[];
  systemPrompt: string;
}

export interface IAgentRegistry {
  register(agent: AgentDefinition): void;
  getByRole(role: string): AgentDefinition | null;
  getAll(): AgentDefinition[];
  getEnabled(): AgentDefinition[];
}
