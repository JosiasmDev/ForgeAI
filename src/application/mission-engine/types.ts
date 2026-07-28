export interface Task {
  id: string;
  missionId: string;
  title: string;
  description: string;
  assignedAgentRole: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  input: string;
  output?: string;
}

export interface Mission {
  id: string;
  projectId: string;
  goal: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  tasks: Task[];
}

export interface IMissionEngine {
  createMission(projectId: string, goal: string, tasks: Task[]): Promise<Mission>;
  executeMission(missionId: string, onTaskUpdate?: (task: Task) => void): Promise<Mission>;
  getMission(missionId: string): Promise<Mission | null>;
}
