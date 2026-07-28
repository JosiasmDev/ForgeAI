import { IMissionEngine, Mission, Task } from './types';
import { IStorageAdapter } from '../../infrastructure/storage/types';
import { IAIProvider } from '../../infrastructure/ai-provider/types';
import { IAgentRegistry } from '../../domain/agent-engine/types';
import { createUid } from '../../kernel/event-bus/EventBus';

export class MissionEngine implements IMissionEngine {
  private storage: IStorageAdapter;
  private aiProvider: IAIProvider;
  private agentRegistry: IAgentRegistry;

  constructor(storage: IStorageAdapter, aiProvider: IAIProvider, agentRegistry: IAgentRegistry) {
    this.storage = storage;
    this.aiProvider = aiProvider;
    this.agentRegistry = agentRegistry;
  }

  public async createMission(projectId: string, goal: string, tasks: Task[]): Promise<Mission> {
    const mission: Mission = {
      id: createUid('mission'),
      projectId,
      goal,
      status: 'pending',
      tasks,
    };
    await this.storage.put('missions', mission);
    return mission;
  }

  public async getMission(missionId: string): Promise<Mission | null> {
    return this.storage.get<Mission>('missions', missionId);
  }

  public async executeMission(missionId: string, onTaskUpdate?: (task: Task) => void): Promise<Mission> {
    const mission = await this.getMission(missionId);
    if (!mission) throw new Error(`Mission ${missionId} not found`);

    mission.status = 'running';
    await this.storage.put('missions', mission);

    for (const task of mission.tasks) {
      task.status = 'running';
      onTaskUpdate?.(task);

      const agent = this.agentRegistry.getByRole(task.assignedAgentRole);
      const systemPrompt = agent ? agent.systemPrompt : 'Eres un asistente IA.';

      const response = await this.aiProvider.execute({
        model: 'default',
        systemPrompt,
        messages: [{ role: 'user', content: `${task.title}: ${task.input}` }],
      });

      task.output = response.content;
      task.status = 'completed';
      onTaskUpdate?.(task);

      await this.storage.put('missions', mission);
    }

    mission.status = 'completed';
    await this.storage.put('missions', mission);
    return mission;
  }
}
