import { Task, Mission } from '../mission-engine/types';
import { ValidationReport } from '../../domain/validation-engine/types';

export interface TaskExecutionResult {
  output: string;
  score: number;
  validationReport?: ValidationReport;
  durationMs: number;
}

export interface IExecutionEngine {
  executeTask(task: Task, mission: Mission): Promise<TaskExecutionResult>;
}
