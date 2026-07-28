import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';

import { Kernel } from './kernel/Kernel';
import { MemoryAdapter } from './infrastructure/storage/MemoryAdapter';
import { IndexedDBAdapter } from './infrastructure/storage/IndexedDBAdapter';
import { SimulationProvider } from './infrastructure/ai-provider/SimulationProvider';
import { AnthropicProvider } from './infrastructure/ai-provider/AnthropicProvider';
import { ModelRouter } from './infrastructure/model-router/ModelRouter';
import { PermissionEngine } from './infrastructure/permission-engine/PermissionEngine';
import { ToolRegistry } from './infrastructure/tool-engine/ToolRegistry';

import { AgentRegistry } from './domain/agent-engine/AgentRegistry';
import { MemoryEngine } from './domain/memory-engine/MemoryEngine';
import { KnowledgeGraph } from './domain/knowledge-graph/KnowledgeGraph';
import { ContextEngine } from './domain/context-engine/ContextEngine';
import { PromptEngine } from './domain/prompt-engine/PromptEngine';
import { ValidationEngine } from './domain/validation-engine/ValidationEngine';
import { TestingEngine } from './domain/testing-engine/TestingEngine';

import { Planner } from './application/planner/Planner';
import { ExecutionEngine } from './application/execution-engine/ExecutionEngine';
import { MissionEngine } from './application/mission-engine/MissionEngine';
import { PluginLoader } from './plugins/plugin-loader/PluginLoader';

import { TOKENS } from './kernel/di/tokens';
import { Task, Mission } from './application/mission-engine/types';

// Complete Expanded Architecture Bootstrapping
const kernel = new Kernel();
const memoryStorage = new MemoryAdapter();
const indexedDBStorage = new IndexedDBAdapter();

const simulationProvider = new SimulationProvider();
const anthropicProvider = new AnthropicProvider();

const modelRouter = new ModelRouter(simulationProvider);
modelRouter.registerProvider(anthropicProvider);

const permissionEngine = new PermissionEngine();
const toolRegistry = new ToolRegistry();

const agentRegistry = new AgentRegistry();
const memoryEngine = new MemoryEngine(indexedDBStorage);
const knowledgeGraph = new KnowledgeGraph();
const contextEngine = new ContextEngine(memoryEngine);
const promptEngine = new PromptEngine();
const validationEngine = new ValidationEngine();
const testingEngine = new TestingEngine();

const planner = new Planner(simulationProvider);
const executionEngine = new ExecutionEngine(
  modelRouter,
  contextEngine,
  promptEngine,
  validationEngine,
  memoryEngine
);
const missionEngine = new MissionEngine(indexedDBStorage, simulationProvider, agentRegistry);
const pluginLoader = new PluginLoader();

// Register In DI Container
kernel.services.register(TOKENS.Storage, () => indexedDBStorage);
kernel.services.register(TOKENS.AIProvider, () => simulationProvider);
kernel.services.register(TOKENS.ModelRouter, () => modelRouter);
kernel.services.register(TOKENS.PermissionEngine, () => permissionEngine);
kernel.services.register(TOKENS.ToolRegistry, () => toolRegistry);
kernel.services.register(TOKENS.AgentRegistry, () => agentRegistry);
kernel.services.register(TOKENS.MemoryEngine, () => memoryEngine);
kernel.services.register(TOKENS.ContextEngine, () => contextEngine);
kernel.services.register(TOKENS.PromptEngine, () => promptEngine);
kernel.services.register(TOKENS.MissionEngine, () => missionEngine);

kernel.boot();

const App: React.FC = () => {
  const [goal, setGoal] = useState('');
  const [activeMission, setActiveMission] = useState<Mission | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const addLog = (msg: string) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const handleStartFullPipeline = async () => {
    if (!goal.trim()) return;
    setIsRunning(true);
    setLogs([]);

    // Initialize physical storage
    await indexedDBStorage.init();
    addLog('IndexedDB persistente inicializado correctamente.');

    addLog(`Iniciando pipeline completo con IndexedDB y AnthropicProvider listo...`);

    // Step 1: Planner
    addLog('Paso 1: Invocando Planner...');
    const plan = await planner.plan(goal, 'Proyecto de producción');
    addLog(`Planner descompuso en ${plan.tasks.length} tareas.`);

    // Step 2: Create Mission
    addLog('Paso 2: Persistiendo Misión en IndexedDB...');
    const tasks: Task[] = plan.tasks.map((pt, idx) => ({
      id: `t_${idx}_${Date.now()}`,
      missionId: '',
      title: pt.title,
      description: pt.description,
      assignedAgentRole: pt.agentRole,
      status: 'pending',
      input: pt.input,
    }));

    const mission = await missionEngine.createMission('proj_prod', goal, tasks);
    setActiveMission(mission);

    // Step 3: Run Execution Engine
    for (const task of mission.tasks) {
      addLog(`Ejecutando Tarea: ${task.title} (${task.assignedAgentRole})`);
      task.status = 'running';
      setActiveMission({ ...mission });

      const execResult = await executionEngine.executeTask(task, mission);
      task.output = execResult.output;
      task.status = 'completed';

      addLog(`✓ Tarea "${task.title}" completada. Score: ${execResult.score}/100`);
      setActiveMission({ ...mission });
    }

    // Step 4: Run Automated Tests
    addLog('Paso 4: Verificación automatizada...');
    const testResult = await testingEngine.runTests('proj_prod');
    addLog(`✓ Tests pasados: ${testResult.passed}/${testResult.total}`);

    addLog('🎉 Ciclo de desarrollo completado al 100%. Todo persistido.');
    setIsRunning(false);
  };

  return (
    <div style={{ padding: 40, fontFamily: 'Inter, sans-serif', background: '#080C18', color: '#f1f5f9', minHeight: '100vh' }}>
      <header style={{ borderBottom: '1px solid #1E2B42', paddingBottom: 20, marginBottom: 30 }}>
        <h1 style={{ fontFamily: 'Space Grotesk', color: '#10B981' }}>
          ⚡ ForgeAI v4.0 — Plataforma Autónoma Completa con Persistencia Física
        </h1>
        <p style={{ color: '#94A3B8', marginTop: 5 }}>
          IndexedDB + AnthropicProvider + KnowledgeGraph + PluginLoader + ModelRouter + ExecutionEngine
        </p>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 30 }}>
        <div>
          <div style={{ background: '#0E1525', padding: 20, borderRadius: 12, border: '1px solid #1E2B42', marginBottom: 20 }}>
            <h3>🚀 Ejecutar Ciclo Autónomo Completo</h3>
            <input
              type="text"
              placeholder="Ej: Crear un marketplace de plugins en React y Node"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              style={{
                width: '100%',
                padding: '12px 14px',
                background: '#141C2E',
                border: '1px solid #1E2B42',
                color: '#fff',
                borderRadius: 8,
                outline: 'none',
                marginTop: 10,
                marginBottom: 12,
              }}
            />
            <button
              onClick={handleStartFullPipeline}
              disabled={isRunning || !goal.trim()}
              style={{
                padding: '12px 24px',
                background: '#10B981',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                fontWeight: 600,
                cursor: isRunning ? 'not-allowed' : 'pointer',
                opacity: isRunning ? 0.6 : 1,
              }}
            >
              {isRunning ? '⚡ Ejecutando...' : 'Ejecutar Ciclo Final'}
            </button>
          </div>

          <div style={{ background: '#0E1525', padding: 20, borderRadius: 12, border: '1px solid #1E2B42' }}>
            <h3>📡 Traza y logs de Observabilidad</h3>
            <div
              style={{
                marginTop: 15,
                padding: 12,
                background: '#080C18',
                borderRadius: 8,
                border: '1px solid #1E2B42',
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 12,
                color: '#A78BFA',
                maxHeight: 250,
                overflowY: 'auto',
              }}
            >
              {logs.length === 0 ? 'Esperando inicio del ciclo...' : logs.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          </div>
        </div>

        <div>
          <div style={{ background: '#0E1525', padding: 20, borderRadius: 12, border: '1px solid #1E2B42', minHeight: 450 }}>
            <h3>📊 Estado de Misión y Tareas Persistidas</h3>
            {!activeMission ? (
              <p style={{ color: '#64748B', marginTop: 20 }}>No hay misión activa.</p>
            ) : (
              <div style={{ marginTop: 15, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <h4>Objetivo: {activeMission.goal}</h4>
                {activeMission.tasks.map((t, idx) => (
                  <div key={t.id} style={{ padding: 14, background: '#141C2E', borderRadius: 8, border: '1px solid #1E2B42' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontWeight: 600, color: '#F1F5F9' }}>
                        #{idx + 1} {t.title} ({t.assignedAgentRole})
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          padding: '2px 8px',
                          borderRadius: 12,
                          background: t.status === 'completed' ? '#10B98120' : t.status === 'running' ? '#F59E0B20' : '#1E2B42',
                          color: t.status === 'completed' ? '#10B981' : t.status === 'running' ? '#F59E0B' : '#64748B',
                        }}
                      >
                        {t.status}
                      </span>
                    </div>
                    {t.output && (
                      <pre
                        style={{
                          fontSize: 11,
                          color: '#94A3B8',
                          background: '#080C18',
                          padding: 10,
                          borderRadius: 6,
                          marginTop: 8,
                          whiteSpace: 'pre-wrap',
                        }}
                      >
                        {t.output}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
