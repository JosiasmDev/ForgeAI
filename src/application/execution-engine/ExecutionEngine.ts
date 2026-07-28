import { IExecutionEngine, TaskExecutionResult } from './types';
import { Task, Mission } from '../mission-engine/types';
import { IModelRouter } from '../../infrastructure/model-router/types';
import { IContextEngine } from '../../domain/context-engine/types';
import { IPromptEngine } from '../../domain/prompt-engine/types';
import { IValidationEngine } from '../../domain/validation-engine/types';
import { IMemoryEngine } from '../../domain/memory-engine/types';

export class ExecutionEngine implements IExecutionEngine {
  private modelRouter: IModelRouter;
  private contextEngine: IContextEngine;
  private promptEngine: IPromptEngine;
  private validationEngine: IValidationEngine;
  private memoryEngine: IMemoryEngine;

  constructor(
    modelRouter: IModelRouter,
    contextEngine: IContextEngine,
    promptEngine: IPromptEngine,
    validationEngine: IValidationEngine,
    memoryEngine: IMemoryEngine
  ) {
    this.modelRouter = modelRouter;
    this.contextEngine = contextEngine;
    this.promptEngine = promptEngine;
    this.validationEngine = validationEngine;
    this.memoryEngine = memoryEngine;
  }

  public async executeTask(task: Task, mission: Mission): Promise<TaskExecutionResult> {
    const start = Date.now();

    // 1. Build Context
    const context = await this.contextEngine.buildContext(
      mission.projectId,
      task.assignedAgentRole,
      task.input
    );

    // 2. Build Prompt
    const prompt = this.promptEngine.build(task.assignedAgentRole, task.title, task.input, context);

    // 3. AI Execution via ModelRouter
    const aiResponse = await this.modelRouter.execute(
      {
        model: 'default',
        systemPrompt: prompt.systemPrompt,
        messages: [{ role: 'user', content: prompt.userPrompt }],
      },
      {
        taskType: 'code_generation',
        complexity: 'medium',
        agentRole: task.assignedAgentRole,
      }
    );

    // 4. Validation
    const validationReport = await this.validationEngine.validate(
      aiResponse.content,
      task.assignedAgentRole === 'developer' ? 'code' : 'markdown'
    );

    // 5. Store Memory
    await this.memoryEngine.store({
      id: `mem_${Date.now()}`,
      type: 'learning',
      title: `Execution of ${task.title}`,
      content: aiResponse.content.slice(0, 200),
      sourceAgent: task.assignedAgentRole,
      projectId: mission.projectId,
      timestamp: new Date().toISOString(),
      confidence: validationReport.score / 100,
    });

    return {
      output: aiResponse.content,
      score: validationReport.score,
      validationReport,
      durationMs: Date.now() - start,
    };
  }
}
