export interface TestResult {
  total: number;
  passed: number;
  failed: number;
  duration: number;
}

export interface ITestingEngine {
  runTests(projectId: string): Promise<TestResult>;
}
