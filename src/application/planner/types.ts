import { Task } from '../mission-engine/types';

export interface PlannedTask {
  title: string;
  description: string;
  agentRole: string;
  input: string;
}

export interface ExecutionPlan {
  goal: string;
  tasks: PlannedTask[];
  reasoning: string;
}

export interface IPlanner {
  plan(goal: string, contextDescription: string): Promise<ExecutionPlan>;
}
