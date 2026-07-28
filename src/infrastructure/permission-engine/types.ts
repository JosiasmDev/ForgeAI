import { IExecutionContext } from '../../kernel/execution-context/types';

export interface PermissionRequest {
  agentRole: string;
  action: string;
  resource: string;
  context: IExecutionContext;
}

export interface PermissionResult {
  allowed: boolean;
  reason: string;
  requiresApproval: boolean;
}

export interface IPermissionEngine {
  check(request: PermissionRequest): PermissionResult;
  requestApproval(request: PermissionRequest): Promise<PermissionResult>;
}
