import { IValidationEngine, ValidationReport, ValidationIssue } from './types';

export class ValidationEngine implements IValidationEngine {
  public async validate(content: string, type: 'code' | 'markdown' | 'json'): Promise<ValidationReport> {
    const issues: ValidationIssue[] = [];
    let score = 90;

    if (!content || content.trim().length === 0) {
      return { valid: false, score: 0, issues: [{ severity: 'error', category: 'syntax', message: 'Empty output' }] };
    }

    if (type === 'json') {
      try {
        JSON.parse(content);
      } catch (err) {
        issues.push({ severity: 'error', category: 'json_syntax', message: (err as Error).message });
        score = 0;
      }
    }

    if (type === 'code' && !content.includes('export') && !content.includes('function')) {
      issues.push({ severity: 'warning', category: 'structure', message: 'Code might missing exported symbols' });
      score -= 15;
    }

    return {
      valid: issues.every((i) => i.severity !== 'error'),
      score: Math.max(0, score),
      issues,
    };
  }
}
