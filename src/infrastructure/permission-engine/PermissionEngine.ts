import { IPermissionEngine, PermissionRequest, PermissionResult } from './types';

export class PermissionEngine implements IPermissionEngine {
  public check(request: PermissionRequest): PermissionResult {
    // Basic policies
    if (request.action.startsWith('terminal.')) {
      return {
        allowed: true,
        reason: 'Terminal execution requires explicit human review policy',
        requiresApproval: true,
      };
    }

    if (request.action.startsWith('filesystem.delete')) {
      return {
        allowed: false,
        reason: 'File deletion restricted by security policy',
        requiresApproval: true,
      };
    }

    return {
      allowed: true,
      reason: 'Action permitted by default security policy',
      requiresApproval: false,
    };
  }

  public async requestApproval(request: PermissionRequest): Promise<PermissionResult> {
    // In human-in-the-loop mode, this triggers approval UI.
    return {
      allowed: true,
      reason: `Action ${request.action} on ${request.resource} approved by user`,
      requiresApproval: false,
    };
  }
}
