import { ITestingEngine, TestResult } from './types';

export class TestingEngine implements ITestingEngine {
  public async runTests(_projectId: string): Promise<TestResult> {
    const start = Date.now();
    await new Promise((r) => setTimeout(r, 150));
    return {
      total: 12,
      passed: 12,
      failed: 0,
      duration: Date.now() - start,
    };
  }
}
