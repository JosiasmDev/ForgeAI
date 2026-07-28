export interface ValidationIssue {
  severity: 'error' | 'warning' | 'info';
  category: string;
  message: string;
  line?: number;
}

export interface ValidationReport {
  valid: boolean;
  score: number;
  issues: ValidationIssue[];
}

export interface IValidationEngine {
  validate(content: string, type: 'code' | 'markdown' | 'json'): Promise<ValidationReport>;
}
