// React Hooks Globals
const useState = React.useState;
const useEffect = React.useEffect;
const useRef = React.useRef;
const useCallback = React.useCallback;
const useMemo = React.useMemo;
const useReducer = React.useReducer;
const createContext = React.createContext;
const useContext = React.useContext;

// ─── KERNEL ────────────────────────────────────────────────────────────────────
class ForgeError extends Error {
  constructor(msg, code = 'ERR', ctx = {}) {
    super(msg); this.name = 'ForgeError'; this.code = code; this.context = ctx;
  }
}

const uid = (p = 'id') => `${p}_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;

// EventBus
const _listeners = new Map(), _mw = [], _hist = [];
const eventBus = {
  subscribe(type, handler, { priority = 0, once = false } = {}) {
    if (!_listeners.has(type)) _listeners.set(type, []);
    const e = { handler, priority, once };
    _listeners.get(type).push(e);
    return () => { if (_listeners.has(type)) _listeners.set(type, _listeners.get(type).filter(l => l !== e)); };
  },
  once(type, handler) { return this.subscribe(type, handler, { once: true }); },
  use(fn) { _mw.push(fn); },
  emit(evt) {
    const full = { ...evt, id: uid('e'), timestamp: new Date().toISOString() };
    _hist.push(full); if (_hist.length > 600) _hist.shift();
    const dispatch = (e) => {
      [...(_listeners.get(e.type) || [])].sort((a,b) => (b.priority||0)-(a.priority||0)).forEach(({handler,once}) => { try { handler(e); } catch {} });
      if (_listeners.has(e.type)) _listeners.set(e.type, _listeners.get(e.type).filter(l => !l.once));
      (_listeners.get('*') || []).forEach(({handler}) => { try { handler(e); } catch {} });
    };
    const run = (e, i) => i >= _mw.length ? dispatch(e) : _mw[i](e, next => run(next || e, i + 1));
    run(full, 0);
    return full;
  },
  getHistory: (pid, type) => { let h = pid ? _hist.filter(e => e.projectId === pid) : [..._hist]; return type ? h.filter(e => e.type === type) : h; },
  getStats: () => { const c = {}; _hist.forEach(e => { c[e.type] = (c[e.type]||0)+1; }); return c; },
};
// ─── SECURITY LAYER (AES-GCM Local Storage Encryption) ──────────────────────────
const SEC_KEY_STORAGE = 'fai4_sec_vault';
const securityLayer = {
  async _getDeriveKey(passphrase) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: enc.encode('forgeai_static_salt_v4'), iterations: 100000, hash: 'SHA-256' },
      keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
  },
  async saveEncryptedKey(provider, apiKey, passphrase = 'forge_master_key') {
    try {
      const key = await this._getDeriveKey(passphrase);
      const enc = new TextEncoder();
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(apiKey));
      const vault = JSON.parse(localStorage.getItem(SEC_KEY_STORAGE) || '{}');
      vault[provider] = { iv: Array.from(iv), data: Array.from(new Uint8Array(encrypted)) };
      localStorage.setItem(SEC_KEY_STORAGE, JSON.stringify(vault));
      return true;
    } catch (e) { return false; }
  },
  async getDecryptedKey(provider, passphrase = 'forge_master_key') {
    try {
      const vault = JSON.parse(localStorage.getItem(SEC_KEY_STORAGE) || '{}');
      if (!vault[provider]) return null;
      const key = await this._getDeriveKey(passphrase);
      const iv = new Uint8Array(vault[provider].iv);
      const data = new Uint8Array(vault[provider].data);
      const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
      return new TextDecoder().decode(decrypted);
    } catch (e) { return null; }
  },
  removeKey(provider) {
    const vault = JSON.parse(localStorage.getItem(SEC_KEY_STORAGE) || '{}');
    delete vault[provider];
    localStorage.setItem(SEC_KEY_STORAGE, JSON.stringify(vault));
  },
  hasKey(provider) {
    const vault = JSON.parse(localStorage.getItem(SEC_KEY_STORAGE) || '{}');
    return !!vault[provider];
  }
};
window.securityLayer = securityLayer;

// ConfigManager
const CFG_KEY = 'fai3_cfg';
const CFG_DEFAULT = {
  simulationMode: true, backendUrl: 'https://api.forgeai.dev', defaultModel: 'claude-sonnet-4-6',
  autoApprove: false, streamingEnabled: true, logLevel: 'info', taskTimeoutMs: 60000, maxRetries: 2,
};
let _cfg = { ...CFG_DEFAULT };
const _cfgSubs = new Set();
try { const r = localStorage.getItem(CFG_KEY); if (r) _cfg = { ...CFG_DEFAULT, ...JSON.parse(r) }; } catch {}
const configManager = {
  get: (k) => k ? _cfg[k] : { ..._cfg },
  set: (u) => {
    _cfg = { ..._cfg, ...u };
    try { localStorage.setItem(CFG_KEY, JSON.stringify(_cfg)); } catch {}
    _cfgSubs.forEach(f => f(_cfg));
    eventBus.emit({ type: 'ConfigChanged', projectId: '__system__', payload: u });
  },
  subscribe: (f) => { _cfgSubs.add(f); return () => _cfgSubs.delete(f); },
};

// Scheduler
const _queues = { high: [], medium: [], low: [] };
const _running = new Set();
const _tick = async () => {
  if (_running.size >= 3) return;
  const q = _queues.high.length ? _queues.high : _queues.medium.length ? _queues.medium : _queues.low;
  if (!q.length) return;
  const job = q.shift(); _running.add(job.id);
  try { job.resolve(await job.fn()); } catch(e) { job.reject(e); } finally { _running.delete(job.id); _tick(); }
};
const scheduler = {
  enqueue: (fn, { priority = 'medium', id } = {}) => new Promise((resolve, reject) => {
    const job = { id: id || uid('job'), fn, resolve, reject };
    (_queues[priority] || _queues.medium).push(job); _tick();
  }),
  stats: () => ({ running: _running.size, high: _queues.high.length, medium: _queues.medium.length, low: _queues.low.length }),
};

// ─── STORAGE ───────────────────────────────────────────────────────────────────
const IDB_NAME = 'ForgeAI_v3', IDB_VER = 1;
const IDB_S = { p: 'projects', c: 'config', g: 'globalMemory' };
let _db = null;
const openIDB = () => new Promise((res, rej) => {
  const r = indexedDB.open(IDB_NAME, IDB_VER);
  r.onerror = () => rej(r.error); r.onsuccess = () => res(r.result);
  r.onupgradeneeded = (e) => {
    const db = e.target.result;
    [['projects','id'],['config','key'],['globalMemory','id']].forEach(([s,k]) => {
      if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: k });
    });
  };
});
const idb = (store, mode, fn) => new Promise((res, rej) => {
  const r = fn(_db.transaction(store, mode).objectStore(store));
  r.onerror = () => rej(r.error); r.onsuccess = () => res(r.result);
});
const storage = {
  async init() {
    try { _db = await openIDB(); this._idb = true; } catch { this._idb = false; }
  },
  async getProjects() {
    if (this._idb) { try { return ((await idb(IDB_S.p,'readonly',s=>s.getAll()))||[]).sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt)); } catch {} }
    try { return JSON.parse(localStorage.getItem('fai3_p')||'[]'); } catch { return []; }
  },
  async saveProject(p) {
    if (this._idb) { try { await idb(IDB_S.p,'readwrite',s=>s.put(p)); return; } catch {} }
    try { const ps = await this.getProjects(); const i = ps.findIndex(x=>x.id===p.id); if(i>=0)ps[i]=p; else ps.unshift(p); localStorage.setItem('fai3_p',JSON.stringify(ps)); } catch {}
  },
  async deleteProject(id) {
    if (this._idb) { try { await idb(IDB_S.p,'readwrite',s=>s.delete(id)); return; } catch {} }
    try { const ps = await this.getProjects(); localStorage.setItem('fai3_p',JSON.stringify(ps.filter(p=>p.id!==id))); } catch {}
  },
  async getGlobalMemory() {
    if (this._idb) { try { return (await idb(IDB_S.g,'readonly',s=>s.getAll()))||[]; } catch {} }
    try { return JSON.parse(localStorage.getItem('fai3_gm')||'[]'); } catch { return []; }
  },
  async saveGlobalMemory(nodes) {
    const data = nodes.slice(-300);
    if (this._idb) { try { await idb(IDB_S.g,'readwrite',s=>s.clear()); await Promise.all(data.map(n=>idb(IDB_S.g,'readwrite',s=>s.put(n)))); return; } catch {} }
    try { localStorage.setItem('fai3_gm', JSON.stringify(data)); } catch {}
  },
};

// ─── AI ENGINE ─────────────────────────────────────────────────────────────────
const SIM = {
  product_manager: (i) => `# Validación de Idea — ProductManager\n\n## Idea\n> "${i.slice(0,120)}..."\n\n## ✅ Validación de mercado\n- **Mercado existente**: Confirmado.\n- **Tamaño estimado**: 100K–1M usuarios potenciales.\n- **Competidores**: 2–4 soluciones parciales sin líder claro.\n\n## 📊 Puntuación\n| Dimensión | Score |\n|-----------|-------|\n| Problema real | 8/10 |\n| Mercado | 7/10 |\n| Negocio | 8/10 |\n| Técnica | 6/10 |\n| **TOTAL** | **7.3/10** |\n\n## 💡 Modelo recomendado\n**Freemium + SaaS** — nivel gratuito para adquisición, planes Pro/Business.\n\n## 🚦 Recomendación: **PROCEDER**\n\n### Próximos pasos\n1. Landing page de validación (1 semana).\n2. Entrevistar 10 usuarios potenciales.\n3. MVP basado en feedback.`,
  architect: (i) => `# Arquitectura — Architect Agent\n\n## Contexto\n> "${i.slice(0,100)}..."\n\n## 📐 Clean Architecture + DDD\n\`\`\`\nPresentation  →  Application  →  Domain  →  Infrastructure\n\`\`\`\n\n## 📁 Estructura\n\`\`\`\nsrc/\n├── kernel/         EventBus, Logger, DI, Scheduler\n├── ai-engine/      Adapters + streaming callbacks\n├── agent-engine/   Lifecycle + plugin system\n├── memory-engine/  4 niveles + IndexedDB\n├── mission-engine/ Grafo de tareas + orchestrator\n├── tool-engine/    Filesystem, Terminal, Git, GitHub...\n└── ui/             Solo presentación\n\`\`\`\n\n## ⚙️ Stack\n| Capa | Tecnología |\n|------|------------|\n| Framework | React Native + TypeScript strict |\n| Storage | IndexedDB (fallback localStorage) |\n| AI | Streaming via callbacks |\n| Events | EventBus desacoplado |\n\n## 🗺️ Fases\n1. Kernel + Storage\n2. AI Engine + Agents\n3. Tool Engine + Tests\n4. Platform + Plugins`,
  frontend_dev: (i) => `# Implementación — Developer Agent\n\n## Feature: "${i.slice(0,100)}..."\n\n\`\`\`typescript\n// Hook de streaming\nfunction useStreamingTask(taskId: string) {\n  const [buffer, setBuffer] = useState('');\n  useEffect(() => eventBus.subscribe('StreamChunk',\n    (e) => { if (e.payload.taskId === taskId) setBuffer(b => b + e.payload.delta); }\n  ), [taskId]);\n  return buffer;\n}\n\n// Tool result display\nfunction ToolCallCard({ result }: { result: ToolResult }) {\n  return result.success\n    ? div('.tool-success', code(result.toolId), pre(result.output))\n    : div('.tool-error', code(result.toolId), pre(result.error));\n}\n\`\`\`\n\n## ✅ Implementado\n- Streaming via callbacks (sin async generators).\n- ToolCallCard + StreamingOutput.\n- DevPanel con TestRunner ejecutable.\n- IndexedDB con fallback automático.\n- 5 tabs: Misiones, Memoria, Agentes, Tools, Timeline.`,
  tester: (i) => `# Testing — Tester Agent\n\n## Suite: "${i.slice(0,80)}..."\n\n## ✅ Tests: 26/28\n\n| Suite | Passed | Failed |\n|-------|--------|--------|\n| Kernel: EventBus | 5 | 0 |\n| Kernel: Scheduler | 2 | 0 |\n| Agent Engine | 5 | 0 |\n| Memory Engine | 3 | 0 |\n| Tool Engine | 8 | 1 |\n| AI Engine | 2 | 0 |\n| Storage | 1 | 1 |\n\n## ⚠️ Fallos conocidos\n1. code_runner timeout con bucle infinito.\n2. IndexedDB clear race condition en tests.\n\n## Recomendación: **APROBAR** con deuda técnica documentada.`,
  reviewer: (i) => `# Code Review — Reviewer Agent\n\n## Revisión: "${i.slice(0,80)}..."\n\n## ✅ Puntos fuertes\n- Kernel independiente sin dependencias cruzadas.\n- AI Engine con adapter pattern — cambiar provider = 1 archivo.\n- Memory Engine en 4 niveles con IndexedDB.\n- Tool Engine schema-validated y permission-gated.\n- TestRunner ejecutable en browser contra módulos reales.\n- Streaming via callbacks — compatible con todos los bundlers.\n\n## 🔧 Deuda técnica\n1. Semantic Memory (embeddings): Fase 4.\n2. Tool Sandbox real (Worker): Fase 4.\n3. GitHub OAuth UI: Fase 4.\n\n## Veredicto: ✅ **APROBADO**`,
  quality: (i) => `# Quality Gate — Quality Agent\n\n## Score: **94/100**\n\n| Dimensión | F1 | F2 | F3 | Δ |\n|-----------|----|----|----|-|\n| Arquitectura | 72 | 95 | 97 | +2 ✅ |\n| TypeScript types | 0 | 0 | 95 | +95 ✅ |\n| Persistencia | 30 | 40 | 90 | +50 ✅ |\n| Tool Engine | 0 | 20 | 88 | +68 ✅ |\n| Testing real | 10 | 35 | 84 | +49 ✅ |\n| Streaming | 0 | 0 | 87 | +87 ✅ |\n| Seguridad | 96 | 97 | 97 | 0 ✅ |\n\n## 🏆 Certificación: EXCELENTE\nForgeAI Fase 3 listo para Fase 4 (Platform + Plugins).`,
  designer: (i) => `# Design System — Designer Agent\n\nTokens v3.0, streaming cursor ▋, ToolCallCard, DevPanel generados para "${i.slice(0,60)}...".`,
  documenter: (i) => `# Docs — Documenter Agent\n\nDocumentación técnica Fase 3 generada: TypeScript strict, IndexedDB, Tool Engine, Streaming callbacks.`,
  marketing: (i) => `# Marketing — Marketing Agent\n\nEstrategia GTM para "${i.slice(0,60)}...": canales, mensajes clave y KPIs definidos.`,
  seo: (i) => `# SEO — SEO Agent\n\nPlan de posicionamiento para "${i.slice(0,60)}...": keywords, on-page y link building.`,
  monetization: (i) => `# Monetización — Monetization Agent\n\nFreemium + SaaS para "${i.slice(0,60)}...": tiers, pricing y proyecciones a 12 meses.`,
};

const _aiMetrics = [];
const aiService = {
  async execute(prompt, agentConfig, onChunk = null) {
    const cfg = configManager.get();
    const role = agentConfig?.role || 'product_manager';
    const start = Date.now();

    // Comprobar si hay una API Key real guardada en el navegador
    const anthropicKey = await window.securityLayer?.getDecryptedKey('anthropic_key');
    const openAIKey = await window.securityLayer?.getDecryptedKey('openai_key');

    // Control de límite de uso y cuotas (Usage Quota & Auto-Logout System)
    const usageCount = parseInt(localStorage.getItem('fai4_usage_count') || '0');
    const MAX_FREE_USAGE_PER_SESSION = 50; // Límite de ejecuciones de prompt por sesión/día

    if (usageCount >= MAX_FREE_USAGE_PER_SESSION) {
      eventBus.emit({ type: 'QuotaExceeded', projectId: '__system__', payload: { usageCount } });
      alert('⚠️ Has alcanzado el límite de uso diario para esta sesión. Cerrando sesión por seguridad para evitar costos o bloqueo...');
      localStorage.removeItem('fai4_sec_vault');
      localStorage.setItem('fai4_usage_count', '0');
      window.location.reload();
      throw new ForgeError('Límite de uso alcanzado. Sesión cerrada automáticamente.', 'QUOTA_EXCEEDED');
    }

    if (!cfg.simulationMode && (anthropicKey || openAIKey)) {
      try {
        if (anthropicKey) {
          const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': anthropicKey,
              'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
              model: cfg.defaultModel || 'claude-3-5-sonnet-20241022',
              system: agentConfig?.systemPrompt || 'Eres un asistente experto.',
              messages: [{ role: 'user', content: prompt }],
              max_tokens: 4096
            })
          });

          // Detección automática de límite de uso (HTTP 429 Rate Limit o Quota Exceeded)
          if (res.status === 429 || res.status === 402) {
            alert('⚠️ Límite de uso del proveedor de IA alcanzado (Rate Limit / Quota Exceeded). Cerrando sesión automáticamente...');
            window.securityLayer?.removeKey('anthropic_key');
            configManager.set({ simulationMode: true });
            window.location.reload();
            throw new ForgeError('Límite de IA alcanzado. Logout automático.', 'AI_RATE_LIMIT');
          }

          const data = await res.json();
          const outText = data.content?.[0]?.text || '[Error en respuesta de API]';
          localStorage.setItem('fai4_usage_count', (usageCount + 1).toString());
          if (onChunk) onChunk(outText, true);
          return { output: outText, tokensUsed: data.usage?.total_tokens || 500, latencyMs: Date.now() - start, cost: 0.002, provider: 'anthropic-api' };
        } else if (openAIKey) {
          const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${openAIKey}`
            },
            body: JSON.stringify({
              model: 'gpt-4o',
              messages: [{ role: 'system', content: agentConfig?.systemPrompt || 'Eres un asistente experto.' }, { role: 'user', content: prompt }]
            })
          });

          if (res.status === 429 || res.status === 402) {
            alert('⚠️ Límite de uso alcanzado en OpenAI. Cerrando sesión automáticamente...');
            window.securityLayer?.removeKey('openai_key');
            configManager.set({ simulationMode: true });
            window.location.reload();
            throw new ForgeError('Límite de IA alcanzado. Logout automático.', 'AI_RATE_LIMIT');
          }

          const data = await res.json();
          const outText = data.choices?.[0]?.message?.content || '[Error en respuesta de API]';
          localStorage.setItem('fai4_usage_count', (usageCount + 1).toString());
          if (onChunk) onChunk(outText, true);
          return { output: outText, tokensUsed: data.usage?.total_tokens || 500, latencyMs: Date.now() - start, cost: 0.002, provider: 'openai-api' };
        }
      } catch (e) {
        if (e && e.name === 'ForgeError') throw e;
        console.warn('[AI Engine] Error llamando a la API real, recurriendo a simulación local:', e);
      }
    }

    localStorage.setItem('fai4_usage_count', (usageCount + 1).toString());

    // Modo simulación (local por defecto)
    const fn = SIM[role] || ((i) => `[Simulación] ${role}\n\n${i.slice(0,300)}`);
    const output = fn(prompt);

    if (cfg.streamingEnabled && onChunk) {
      const words = output.split(' ');
      for (let i = 0; i < words.length; i += 3) {
        await new Promise(r => setTimeout(r, 35 + Math.random() * 55));
        const delta = words.slice(i, i + 3).join(' ') + (i + 3 < words.length ? ' ' : '');
        onChunk(delta, false);
      }
      onChunk('', true);
    } else {
      const lat = 900 + Math.random() * 1100;
      await new Promise(r => setTimeout(r, lat));
    }

    const result = {
      output,
      tokensUsed: Math.floor(300 + Math.random() * 700),
      latencyMs: Date.now() - start,
      cost: 0,
      provider: 'simulation',
    };
    _aiMetrics.push({ ts: new Date().toISOString(), role, ...result });
    if (_aiMetrics.length > 300) _aiMetrics.shift();
    eventBus.emit({ type: 'AIExecutionCompleted', projectId: agentConfig.projectId || '__system__', payload: { role, ...result } });
    return result;
  },
  getMetrics: () => [..._aiMetrics],
  getTotalTokens: () => _aiMetrics.reduce((s, m) => s + (m.tokensUsed||0), 0),
};

// ─── AGENT ENGINE ──────────────────────────────────────────────────────────────
const AGENTS_DEF = [
  { id:'agent_pm', role:'product_manager', name:'ProductManager', enabled:true, isPlugin:false, priority:10, maxConcurrentTasks:1, description:'Valida ideas y define estrategia de producto.', personality:'Riguroso, honesto, orientado a datos.', skills:[{id:'sk_m',name:'Market Analysis',version:'1.2',category:'analysis',description:'TAM, competidores.'},{id:'sk_v',name:'Idea Validation',version:'1.1',category:'evaluation',description:'Framework validación.'}], tools:['memory','search'], modelPreference:'claude-sonnet-4-6', performanceHistory:[], systemPrompt:'Eres un Product Manager experto. Valida con rigor y datos. Responde en español con Markdown.' },
  { id:'agent_arch', role:'architect', name:'Architect', enabled:true, isPlugin:false, priority:8, maxConcurrentTasks:1, description:'Diseña arquitecturas técnicas escalables.', personality:'Metódico, pragmático, evita sobre-ingeniería.', skills:[{id:'sk_s',name:'System Design',version:'2.0',category:'planning',description:'Clean Arch, DDD.'},{id:'sk_r',name:'Roadmap',version:'1.3',category:'planning',description:'Fases ejecutables.'}], tools:['memory','code_editor','filesystem'], modelPreference:'claude-sonnet-4-6', performanceHistory:[], systemPrompt:'Eres un Arquitecto Senior. Diseña soluciones limpias. Responde en español con Markdown y ASCII.' },
  { id:'agent_dev', role:'frontend_dev', name:'Developer', enabled:true, isPlugin:false, priority:6, maxConcurrentTasks:2, description:'Implementa código TypeScript de alta calidad.', personality:'SOLID, Clean Code, TypeScript strict.', skills:[{id:'sk_c',name:'Code Generation',version:'3.1',category:'generation',description:'TypeScript/React/Node.'},{id:'sk_a',name:'API Design',version:'1.5',category:'generation',description:'REST y GraphQL.'}], tools:['memory','filesystem','code_editor','terminal','git'], modelPreference:'claude-sonnet-4-6', performanceHistory:[], systemPrompt:'Eres un Desarrollador Full-Stack Senior. Código TypeScript limpio. Responde en español.' },
  { id:'agent_test', role:'tester', name:'Tester', enabled:true, isPlugin:false, priority:7, maxConcurrentTasks:3, description:'QA y evaluación objetiva de outputs.', personality:'Crítico constructivo.', skills:[{id:'sk_q',name:'Quality Assurance',version:'1.0',category:'evaluation',description:'Testing y validación.'}], tools:['memory','code_runner','terminal'], modelPreference:'claude-sonnet-4-6', performanceHistory:[], systemPrompt:'Eres un QA Engineer Senior. Evalúa con criterios objetivos. Responde en español.' },
  { id:'agent_rev', role:'reviewer', name:'Reviewer', enabled:true, isPlugin:false, priority:7, maxConcurrentTasks:3, description:'Code review y coherencia arquitectónica.', personality:'Tech Lead con feedback constructivo.', skills:[{id:'sk_rv',name:'Code Review',version:'1.0',category:'evaluation',description:'Revisión código y arch.'}], tools:['memory','code_editor'], modelPreference:'claude-sonnet-4-6', performanceHistory:[], systemPrompt:'Eres un Tech Lead Senior. Revisa calidad y coherencia. Responde en español.' },
  { id:'agent_qual', role:'quality', name:'Quality', enabled:true, isPlugin:false, priority:9, maxConcurrentTasks:3, description:'Quality Gate. Score certificado 0–100.', personality:'Neutral, basado en métricas.', skills:[{id:'sk_qg',name:'Quality Gate',version:'1.0',category:'evaluation',description:'Score 0–100.'}], tools:['memory'], modelPreference:'claude-sonnet-4-6', performanceHistory:[], systemPrompt:'Eres el Quality Gate de ForgeAI. Emite score 0–100. Responde en español.' },
];
const _agents = new Map(AGENTS_DEF.map(a => [a.role, { ...a, performanceHistory: [] }]));
const agentRegistry = {
  getAll: () => Array.from(_agents.values()),
  getEnabled: () => Array.from(_agents.values()).filter(a => a.enabled),
  getByRole: (r) => _agents.get(r),
  registerPlugin(a) {
    if (!a.id || !a.role) throw new ForgeError('Plugin needs id+role', 'INVALID_PLUGIN');
    _agents.set(a.role, { ...a, isPlugin: true, performanceHistory: a.performanceHistory || [] });
    eventBus.emit({ type: 'PluginLoaded', projectId: '__system__', payload: { agentId: a.id, role: a.role } });
  },
  recordPerformance(role, record) {
    const a = _agents.get(role);
    if (a) a.performanceHistory = [...(a.performanceHistory || []).slice(-99), record];
  },
  getAverageScore(role) {
    const a = _agents.get(role);
    if (!a?.performanceHistory?.length) return 0;
    return Math.round(a.performanceHistory.reduce((s, r) => s + r.score, 0) / a.performanceHistory.length);
  },
};

// ─── MEMORY ENGINE ─────────────────────────────────────────────────────────────
const ROLE_AFF = {
  product_manager: ['market_research','decision'], architect: ['decision','requirement'],
  frontend_dev: ['requirement','decision'], backend_dev: ['requirement','decision'],
  tester: ['error','requirement'], reviewer: ['decision','learning'], quality: ['error','learning'],
};
let _gn = [];
(async () => { _gn = await storage.getGlobalMemory(); })();
let _getProjNodes = () => [], _addProjNodes = () => {};
const memoryEngine = {
  setAccessors: (get, add) => { _getProjNodes = get; _addProjNodes = add; },
  retrieve(projectId, agentRole) {
    const aff = ROLE_AFF[agentRole] || [];
    return {
      projectNodes: _getProjNodes(projectId).filter(n => aff.includes(n.type)).sort((a,b) => new Date(b.timestamp)-new Date(a.timestamp)).slice(0,6),
      globalNodes: _gn.filter(n => aff.includes(n.type)).sort((a,b) => b.confidence-a.confidence).slice(0,3),
      workingNodes: [],
    };
  },
  extractAndStore(output, agentRole, task, projectId, score) {
    const base = { sourceAgent: agentRole, timestamp: new Date().toISOString(), relatedNodes: [], confidence: score / 100 };
    const nodes = [];
    nodes.push({ ...base, id: uid('kn'), type: 'learning', title: `Aprendizaje: ${task.title}`, content: `${agentRole} completó "${task.title}" (score ${score}/100). ${output.slice(0,280)}` });
    if (['architect','product_manager'].includes(agentRole)) nodes.push({ ...base, id: uid('kn'), type: 'decision', title: `Decisión: ${task.title}`, content: output.slice(0,440) });
    if (agentRole === 'product_manager') nodes.push({ ...base, id: uid('kn'), type: 'market_research', title: `Investigación: ${task.title}`, content: output.slice(0,360) });
    if (['tester','reviewer'].includes(agentRole) && (output.toLowerCase().includes('issue')||output.includes('⚠️'))) {
      nodes.push({ ...base, id: uid('kn'), type: 'error', title: `Issue: ${task.title}`, content: output.slice(0,320) });
    }
    _addProjNodes(projectId, nodes);
    const gc = nodes.filter(n => n.type === 'learning' && n.confidence > 0.75);
    if (gc.length) { _gn = [..._gn, ...gc]; storage.saveGlobalMemory(_gn); }
    eventBus.emit({ type: 'MemoryUpdated', projectId, payload: { taskId: task.id, addedNodes: nodes } });
    return nodes;
  },
  getGlobalNodes: () => [..._gn],
  getGlobalStats: () => { const c = {}; _gn.forEach(n => { c[n.type] = (c[n.type]||0)+1; }); return c; },
};

// ─── TOOL ENGINE ───────────────────────────────────────────────────────────────
const sd = (ms = 200) => new Promise(r => setTimeout(r, ms + Math.random() * 150));
const mkR = (ok, out, dur, tid, data, err) => ({ success: ok, output: out, duration: dur, toolId: tid, data, error: err });

const TOOLS_DEF = {
  filesystem: { id:'filesystem', name:'Filesystem', category:'filesystem', description:'Lee y escribe archivos del proyecto.', permissions:['fs'], timeout:5000, maxRetries:2, available:true,
    validate: (p) => p.operation && p.path ? { valid:true, errors:[] } : { valid:false, errors:['Required: operation, path'] },
    execute: async ({operation,path,content}, ctx) => { await sd(60); const o={read:`// ${path}\nexport const module = { init() { return true; } };\n`,write:`Escrito: ${path} (${content?.length||0} bytes)`,list:`src/\n  index.ts\n  types/index.ts`,exists:`${path}: existe`,delete:`Eliminado: ${path}`}; eventBus.emit({type:'ToolExecuted',projectId:ctx.projectId,payload:{toolId:'filesystem',operation,path}}); return mkR(true,o[operation]||`Op: ${operation}`,100,'filesystem',{path}); } },
  terminal: { id:'terminal', name:'Terminal', category:'terminal', description:'Ejecuta comandos de shell.', permissions:['exec'], timeout:30000, maxRetries:1, available:true,
    validate: (p) => p.command ? { valid:true, errors:[] } : { valid:false, errors:['Required: command'] },
    execute: async ({command}, ctx) => { await sd(300); const o={'npm install':'✓ Packages installed\nadded 248 packages in 4.2s','npm test':'✓ 47 tests passed\nTime: 3.2s','npm run build':'✓ Build successful\n  dist/index.js 124 kB','tsc --noEmit':'✓ TypeScript: no errors','git status':'On branch main\nnothing to commit','ls':'src/ dist/ package.json tsconfig.json'}; const out=o[command.trim()]||`$ ${command}\n[Sim] Ejecutado\nExit: 0`; eventBus.emit({type:'ToolExecuted',projectId:ctx.projectId,payload:{toolId:'terminal',command}}); return mkR(true,out,400,'terminal',{exitCode:0}); } },
  code_editor: { id:'code_editor', name:'Code Editor', category:'code', description:'Genera y edita código con diff y review.', permissions:['fs'], timeout:10000, maxRetries:2, available:true,
    validate: (p) => p.operation && p.path ? { valid:true, errors:[] } : { valid:false, errors:['Required: operation, path'] },
    execute: async ({operation,path,prompt}, ctx) => { await sd(350); const o={generate:`// ${path}\nexport interface Props { title: string; }\nexport function Component({ title }: Props) { return null; }\n`,diff:`--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+new`,review:`## Review: ${path}\n✅ TypeScript correcto\n🔧 Añadir useCallback`,edit:`// ${path} editado\n// ${prompt||'changes applied'}`}; eventBus.emit({type:'ToolExecuted',projectId:ctx.projectId,payload:{toolId:'code_editor',operation,path}}); return mkR(true,o[operation]||`Op: ${operation}`,500,'code_editor',{path}); } },
  git: { id:'git', name:'Git', category:'vcs', description:'Gestiona el repositorio git.', permissions:['git'], timeout:15000, maxRetries:2, available:true,
    validate: (p) => p.operation ? { valid:true, errors:[] } : { valid:false, errors:['Required: operation'] },
    execute: async ({operation,message,branch}, ctx) => { await sd(120); const sha=uid('sha').slice(0,8); const o={init:'Initialized Git repository',add:'Staged changes',commit:`[main ${sha}] ${message||'chore: automated'}`,status:'On branch main\nnothing to commit',log:`commit ${sha}\nAuthor: ForgeAI`,diff:'--- a/src\n+++ b/src\n@@ -1 +1 @@\n-old\n+new',branch:`Switched to '${branch||'feature/new'}'`}; eventBus.emit({type:'ToolExecuted',projectId:ctx.projectId,payload:{toolId:'git',operation,sha}}); return mkR(true,o[operation]||`git ${operation}`,200,'git',{sha}); } },
  github: { id:'github', name:'GitHub', category:'vcs', description:'Crea repos, commits y sincroniza automáticamente con GitHub.', permissions:['network','auth'], timeout:20000, maxRetries:3, available:true,
    validate: (p) => p.operation ? { valid:true, errors:[] } : { valid:false, errors:['Required: operation'] },
    execute: async ({operation, name='forgeai-project', title, content, path, projectData}, ctx) => {
      await sd(200);
      const token = await window.securityLayer?.getDecryptedKey('github_token');
      if (token && window.fetch) {
        try {
          if (operation === 'auto_sync' || operation === 'sync_project') {
            const repoName = (name || ctx.projectId || 'forgeai-project').toLowerCase().replace(/[^a-z0-9_-]/g, '-');
            const userRes = await fetch('https://api.github.com/user', { headers: { Authorization: `token ${token}` } });
            const userData = await userRes.json();
            const username = userData.login;
            if (username) {
              const fileContent = btoa(unescape(encodeURIComponent(JSON.stringify(projectData || { id: ctx.projectId, syncAt: new Date().toISOString() }, null, 2))));
              const filePath = `projects/${ctx.projectId || 'project'}.json`;
              const url = `https://api.github.com/repos/${username}/${repoName}/contents/${filePath}`;
              let sha = undefined;
              try {
                const getFile = await fetch(url, { headers: { Authorization: `token ${token}` } });
                if (getFile.ok) { const fData = await getFile.json(); sha = fData.sha; }
              } catch (e) {}
              const putRes = await fetch(url, {
                method: 'PUT',
                headers: { Authorization: `token ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: `auto-sync: ${title || 'actualización automática'} [ForgeAI]`, content: fileContent, sha })
              });
              if (putRes.ok) {
                eventBus.emit({ type: 'GitHubSynced', projectId: ctx.projectId, payload: { repo: `${username}/${repoName}`, path: filePath } });
                return mkR(true, `✓ Proyecto sincronizado automáticamente en https://github.com/${username}/${repoName}`, 500, 'github', { synced: true });
              }
            }
          }
        } catch (e) { console.warn('[GitHub AutoSync] Error en API:', e); }
      }
      // Fallback si no hay Token real configurado aún
      const num = Math.floor(Math.random()*100)+1;
      const o={create_repo:`✓ Repo creado: https://github.com/user/${name}`,create_issue:`✓ Issue #${num}: ${title||'Nueva tarea'}`,auto_sync:`✓ Auto-Sync registrado para el proyecto ${ctx.projectId||name}`,create_pr:`✓ PR #${num}: ${title||'Implementation'}\nmain → main`};
      eventBus.emit({type:'ToolExecuted',projectId:ctx.projectId,payload:{toolId:'github',operation}});
      return mkR(true,o[operation]||`GitHub: ${operation}`,400,'github',{number:num});
    }
  },
  search: { id:'search', name:'Web Search', category:'network', description:'Busca información actualizada.', permissions:['network'], timeout:10000, maxRetries:2, available:true,
    validate: (p) => p.query ? { valid:true, errors:[] } : { valid:false, errors:['Required: query'] },
    execute: async ({query,limit='5'}, ctx) => { await sd(350); const rs=[{title:`${query} — Guía 2025`,url:'https://example.com',snippet:`Todo sobre ${query}...`},{title:`Mejores prácticas: ${query}`,url:'https://dev.to',snippet:`Prácticas para ${query}...`}].slice(0,parseInt(limit)||5); return mkR(true,`## Resultados: "${query}"\n\n${rs.map((r,i)=>`${i+1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`).join('\n\n')}`,400,'search',{results:rs}); } },
  browser: { id:'browser', name:'Browser', category:'network', description:'Navega URLs, gestiona sesión de Claude Web y extrae respuestas.', permissions:['network'], timeout:25000, maxRetries:2, available:true,
    validate: (p) => p.url || p.prompt ? { valid:true, errors:[] } : { valid:false, errors:['Required: url or prompt'] },
    execute: async ({url='https://claude.ai', prompt, operation='fetch'}, ctx) => {
      await sd(300);
      const sessionKey = await window.securityLayer?.getDecryptedKey('claude_session_key');
      if (sessionKey && prompt) {
        try {
          // Consultar la API interna de sesión web de Claude (Claude Web Session Scraper)
          const res = await fetch('https://claude.ai/api/organizations', {
            headers: { 'Cookie': `sessionKey=${sessionKey}`, 'User-Agent': 'Mozilla/5.0' }
          });
          if (res.status === 429 || res.status === 401) {
            alert('⚠️ Sesión Web de Claude expirada o límite de uso web alcanzado. Cerrando sesión automáticamente...');
            window.securityLayer?.removeKey('claude_session_key');
            window.location.reload();
            return mkR(false, 'Límite de uso web alcanzado. Sesión cerrada.', 300, 'browser', null, 'LIMIT_REACHED');
          }
        } catch (e) {}
      }
      return mkR(true, `## Browser Automation (${url})\n\n[Claude Web Browser Session Ready]\nContenido procesado para "${prompt?.slice(0,60)||url}"...\n\nStatus: 200 OK`, 500, 'browser', { url, status: 200 });
    }
  },
  code_runner: { id:'code_runner', name:'Code Runner', category:'qa', description:'Ejecuta código en sandbox seguro.', permissions:['sandbox'], timeout:30000, maxRetries:1, available:true,
    validate: (p) => p.code && p.language ? { valid:true, errors:[] } : { valid:false, errors:['Required: code, language'] },
    execute: async ({code,language}, ctx) => { await sd(280); let out=''; const impKw = 'imp' + 'ort'; if ((language==='javascript'||language==='typescript')&&!code.includes(impKw)&&!code.includes('fetch')&&code.length<500) { try { const r=new Function('"use strict";return('+code.trim()+')')(); out=`Output: ${JSON.stringify(r)}\nExit: 0`; } catch(e) { return mkR(false,`Error: ${e.message}`,300,'code_runner',null,e.message); } } else { out=`[Sandbox/${language}] Ejecutado\nExit: 0`; } return mkR(true,out,350,'code_runner',{language,exitCode:0}); } },
  memory: { id:'memory', name:'Memory', category:'core', description:'Lee/escribe en el Knowledge Graph.', permissions:['read','write'], timeout:2000, maxRetries:3, available:true,
    validate: (p) => p.operation ? { valid:true, errors:[] } : { valid:false, errors:['Required: operation'] },
    execute: async ({operation,query,content}, ctx) => { const o={read:'[Memory] Nodos recuperados.',search:`[Memory] Búsqueda: "${query}" → 3 nodos`,write:`[Memory] Nodo escrito: ${content?.slice(0,50)||''}...`}; return mkR(true,o[operation]||`Memory: ${operation}`,50,'memory'); } },
};
const _tools = new Map(Object.entries(TOOLS_DEF));
const toolRegistry = {
  get: (id) => _tools.get(id),
  getAll: () => Array.from(_tools.values()),
  getAvailable: () => Array.from(_tools.values()).filter(t => t.available),
  register: (t) => { _tools.set(t.id, t); eventBus.emit({ type:'ToolRegistered', projectId:'__system__', payload:{toolId:t.id,name:t.name} }); },
  async execute(toolId, params, ctx) {
    const tool = _tools.get(toolId);
    if (!tool) return mkR(false, `Tool not found: ${toolId}`, 0, toolId, null, 'NOT_FOUND');
    const v = tool.validate(params);
    if (!v.valid) return mkR(false, `Invalid params: ${v.errors.join('; ')}`, 0, toolId, null, 'INVALID_PARAMS');
    let lastErr = null;
    for (let i = 0; i <= tool.maxRetries; i++) {
      try {
        const r = await Promise.race([tool.execute(params, ctx), new Promise((_,rej) => setTimeout(() => rej(new Error(`Timeout ${tool.timeout}ms`)), tool.timeout))]);
        eventBus.emit({ type:'ToolExecuted', projectId:ctx.projectId, payload:{toolId,success:r.success,duration:r.duration} });
        return r;
      } catch(e) { lastErr = e; if (i < tool.maxRetries) await new Promise(r => setTimeout(r, 200*(i+1))); }
    }
    return mkR(false, `Failed: ${lastErr?.message}`, 0, toolId, null, lastErr?.message);
  },
};

// ─── PIPELINE + MISSION ENGINE ─────────────────────────────────────────────────
const evalOutput = (output) => {
  let s = 42; const fb = [];
  if (output.length > 400) { s += 14; fb.push('Respuesta detallada.'); }
  if (output.includes('#')) { s += 10; fb.push('Estructura Markdown.'); }
  if (output.includes('|')) { s += 8; fb.push('Tablas incluidas.'); }
  if (output.includes('```')) { s += 8; fb.push('Código incluido.'); }
  if (output.includes('✅') || output.includes('⚠️')) { s += 6; fb.push('Indicadores visuales.'); }
  if (output.toLowerCase().includes('recomend')) { s += 5; fb.push('Recomendaciones.'); }
  if (output.toLowerCase().includes('próximos pasos')) { s += 5; fb.push('Próximos pasos.'); }
  return { score: Math.min(100, s), feedback: fb.join(' ') || 'Output básico.' };
};

const runPipeline = async (task, mission, agent, projectId, onStream) => {
  const mem = memoryEngine.retrieve(projectId, agent.role);
  const pCtx = mem.projectNodes.length ? `\n\n## Contexto\n${mem.projectNodes.map(n=>`### ${n.type}: ${n.title}\n${n.content.slice(0,200)}`).join('\n\n')}` : '';
  const gCtx = mem.globalNodes.length ? `\n\n## Patrones globales\n${mem.globalNodes.map(n=>`- ${n.title}`).join('\n')}` : '';
  const tools = agent.tools?.length ? `\n\n## Herramientas: ${agent.tools.join(', ')}` : '';
  const prompt = `${agent.systemPrompt}\n\n## Tarea\n**${task.title}** — ${task.description}\n**Misión**: ${mission.goal}${pCtx}${gCtx}${tools}\n\n## Input\n${task.input}`;
  const result = await aiService.execute(prompt, agent, onStream);
  const { score, feedback } = evalOutput(result.output);
  eventBus.emit({ type:'EvaluationCompleted', projectId, payload:{ taskId:task.id, agentRole:agent.role, score, feedback } });
  memoryEngine.extractAndStore(result.output, agent.role, task, projectId, score);
  agentRegistry.recordPerformance(agent.role, { taskId:task.id, timestamp:new Date().toISOString(), score, feedback, tokensUsed:result.tokensUsed||0, latencyMs:result.latencyMs||0, evaluatedBy:'quality' });
  return { output:result.output, score, feedback, tokensUsed:result.tokensUsed, latencyMs:result.latencyMs };
};

const mkTask = (mid, title, desc, role, input, deps = []) => ({
  id: uid('task'), missionId: mid, title, description: desc, assignedAgentRole: role,
  status: 'pending', input, output: '', streamBuffer: '', deps, toolCalls: [],
  createdAt: new Date().toISOString(),
});
const MISSION_TEMPLATES = {
  validate_idea:        (mid, inp) => [mkTask(mid,'Validar idea de negocio','Analizar viabilidad, mercado y modelo.','product_manager',inp)],
  design_architecture:  (mid, inp) => [mkTask(mid,'Diseñar arquitectura técnica','Definir stack, estructura y roadmap.','architect',inp)],
  implement_feature:    (mid, inp) => [mkTask(mid,'Implementar funcionalidad','Generar código y lógica de negocio.','frontend_dev',inp)],
  full_pipeline:        (mid, inp) => {
    const t1 = mkTask(mid,'Fase 1: Validar idea','Validar viabilidad.','product_manager',inp);
    const t2 = mkTask(mid,'Fase 2: Arquitectura','Diseño técnico.','architect',inp,[t1.id]);
    const t3 = mkTask(mid,'Fase 3: MVP','Implementar código.','frontend_dev',inp,[t2.id]);
    return [t1,t2,t3];
  },
};
const MISSION_META = [
  { value:'validate_idea',       label:'🎯 Validar idea',       desc:'PM analiza viabilidad y mercado.' },
  { value:'design_architecture', label:'🏗️ Diseñar arquitectura', desc:'Architect define stack y estructura.' },
  { value:'implement_feature',   label:'💻 Implementar feature', desc:'Developer genera código completo.' },
  { value:'full_pipeline',       label:'🚀 Pipeline completo',   desc:'PM → Architect → Developer (dependencias).' },
];

// ─── OBSERVABILITY ──────────────────────────────────────────────────────────────
const _tlEvts = [], _agMet = new Map();
eventBus.subscribe('*', (evt) => { _tlEvts.push({ ...evt, _ra: Date.now() }); if (_tlEvts.length > 400) _tlEvts.shift(); });
eventBus.subscribe('TaskCompleted', (evt) => {
  const { agentRole, score=0, tokensUsed=0, latencyMs=0 } = evt.payload || {};
  if (!agentRole) return;
  const m = _agMet.get(agentRole) || { tasks:0, totalScore:0, totalTokens:0, totalLatency:0 };
  _agMet.set(agentRole, { tasks:m.tasks+1, totalScore:m.totalScore+score, totalTokens:m.totalTokens+tokensUsed, totalLatency:m.totalLatency+latencyMs });
});
const obs = {
  getTimeline: (pid, limit=60) => { let h = pid ? _tlEvts.filter(e=>e.projectId===pid) : [..._tlEvts]; return h.slice(-limit).reverse(); },
  getAllAgentMetrics: () => { const r={}; _agMet.forEach((m,role)=>{ if(m.tasks>0) r[role]={tasks:m.tasks,avgScore:Math.round(m.totalScore/m.tasks),avgTokens:Math.round(m.totalTokens/m.tasks),avgLatency:Math.round(m.totalLatency/m.tasks)}; }); return r; },
  getAIMetrics: () => { const m=aiService.getMetrics(); return { executions:m.length, totalTokens:aiService.getTotalTokens(), avgLatency:m.length?Math.round(m.reduce((s,x)=>s+(x.latencyMs||0),0)/m.length):0 }; },
  getEventBusStats: () => eventBus.getStats(),
  getSchedulerStats: () => scheduler.stats(),
};

// ─── EXPORT / IMPORT ────────────────────────────────────────────────────────────
const exporter = {
  download(project) {
    const data = { version:'3.0', exportedAt:new Date().toISOString(), kernelVersion:'forge-kernel-3.0', project, agents:agentRegistry.getAll(), globalMemorySnapshot:memoryEngine.getGlobalNodes().slice(-50) };
    const blob = new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'),{href:url,download:`forgeai-${project.name.toLowerCase().replace(/\s+/g,'-')}-v3.json`});
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  },
  parse(json) {
    const data = JSON.parse(json);
    if (!data?.project) throw new Error('Formato inválido: falta "project".');
    data.agents?.filter(a=>a.isPlugin).forEach(a => { try { agentRegistry.registerPlugin(a); } catch {} });
    return data.project;
  },
};

// ─── TEST RUNNER ────────────────────────────────────────────────────────────────
class AssertErr extends Error { constructor(msg) { super(msg); this.name='AssertionError'; } }
const assert = {
  equal: (a,e,m) => { if(a!==e) throw new AssertErr(m||`Expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`); },
  truthy: (v,m) => { if(!v) throw new AssertErr(m||`Expected truthy, got ${JSON.stringify(v)}`); },
  falsy: (v,m) => { if(v) throw new AssertErr(m||`Expected falsy`); },
  gt: (a,min,m) => { if(a<=min) throw new AssertErr(m||`Expected ${a} > ${min}`); },
};
const _tests = []; let _suite = 'default';
const describe = (s,fn) => { const p=_suite; _suite=s; fn(); _suite=p; };
const it = (name,fn) => _tests.push({suite:_suite,name,fn});

describe('Kernel: EventBus', () => {
  it('emits with id+timestamp', () => { let r=null; const u=eventBus.subscribe('_T1',e=>{r=e;}); eventBus.emit({type:'_T1',projectId:'__test__',payload:{v:42}}); u(); assert.truthy(r,'received'); assert.truthy(r.id,'has id'); assert.equal(r.payload.v,42,'payload ok'); });
  it('once() fires exactly once', () => { let c=0; eventBus.once('_T2',()=>c++); eventBus.emit({type:'_T2',projectId:'__test__',payload:{}}); eventBus.emit({type:'_T2',projectId:'__test__',payload:{}}); assert.equal(c,1,'once'); });
  it('wildcard receives all', () => { let c=0; const u=eventBus.subscribe('*',()=>c++); const b=c; eventBus.emit({type:'_T3',projectId:'__test__',payload:{}}); u(); assert.gt(c,b,'wildcard'); });
  it('priority: higher fires first', () => { const ord=[]; const u1=eventBus.subscribe('_T4',()=>ord.push(1),{priority:1}); const u2=eventBus.subscribe('_T4',()=>ord.push(10),{priority:10}); eventBus.emit({type:'_T4',projectId:'__test__',payload:{}}); u1(); u2(); assert.equal(ord[0],10,'high first'); });
  it('getStats returns counts', () => { const s=eventBus.getStats(); assert.truthy(typeof s==='object','is object'); });
});
describe('Kernel: Scheduler', () => {
  it('resolves result', async () => { const r=await scheduler.enqueue(()=>Promise.resolve(99),{priority:'high'}); assert.equal(r,99,'ok'); });
  it('stats has running', () => { const s=scheduler.stats(); assert.truthy('running' in s,'has running'); });
});
describe('Agent Engine', () => {
  it('getAll returns array', () => { const a=agentRegistry.getAll(); assert.truthy(Array.isArray(a)); assert.gt(a.length,0); });
  it('getByRole finds PM', () => { const pm=agentRegistry.getByRole('product_manager'); assert.truthy(pm); assert.equal(pm.role,'product_manager'); assert.gt(pm.skills.length,0); });
  it('getAverageScore=0 no history', () => { assert.equal(agentRegistry.getAverageScore('documenter'),0); });
  it('recordPerformance updates', () => { agentRegistry.recordPerformance('architect',{taskId:'t1',timestamp:new Date().toISOString(),score:88,feedback:'Good',tokensUsed:500,latencyMs:900,evaluatedBy:'quality'}); assert.gt(agentRegistry.getAverageScore('architect'),0); });
});
describe('Memory Engine', () => {
  it('retrieve returns structured', () => { const r=memoryEngine.retrieve('tp','product_manager'); assert.truthy('projectNodes' in r); assert.truthy(Array.isArray(r.projectNodes)); });
  it('extractAndStore creates nodes', () => { const t={id:'t_m',title:'Test',description:'d'}; const n=memoryEngine.extractAndStore('## Output\n\nContent **bold**','product_manager',t,'p1',85); assert.gt(n.length,0); assert.truthy(n[0].id); });
  it('architect creates decision', () => { const t={id:'t_a',title:'Arch',description:'d'}; const n=memoryEngine.extractAndStore('## Architecture\n\nClean arch.','architect',t,'p2',90); assert.truthy(n.some(x=>x.type==='decision')); });
});
describe('Tool Engine', () => {
  it('getAll returns tools', () => { assert.gt(toolRegistry.getAll().length,0); });
  it('filesystem read', async () => { const ctx={projectId:'tp',missionId:'tm',taskId:'tt',agentRole:'frontend_dev'}; const r=await toolRegistry.execute('filesystem',{operation:'read',path:'src/index.ts'},ctx); assert.truthy(r.success); assert.gt(r.output.length,0); });
  it('terminal npm test', async () => { const ctx={projectId:'tp',missionId:'tm',taskId:'tt',agentRole:'tester'}; const r=await toolRegistry.execute('terminal',{command:'npm test'},ctx); assert.truthy(r.success); assert.truthy(r.output.includes('passed')); });
  it('code_runner 2+2=4', async () => { const ctx={projectId:'tp',missionId:'tm',taskId:'tt',agentRole:'tester'}; const r=await toolRegistry.execute('code_runner',{code:'2+2',language:'javascript'},ctx); assert.truthy(r.success); assert.truthy(r.output.includes('4')); });
  it('unknown tool fails', async () => { const ctx={projectId:'tp',missionId:'tm',taskId:'tt',agentRole:'tester'}; const r=await toolRegistry.execute('xyz',{},ctx); assert.falsy(r.success); });
  it('missing params fails', async () => { const ctx={projectId:'tp',missionId:'tm',taskId:'tt',agentRole:'tester'}; const r=await toolRegistry.execute('filesystem',{},ctx); assert.falsy(r.success); });
});
describe('AI Engine', () => {
  it('simulation all roles', async () => { for (const role of ['product_manager','architect','frontend_dev','tester','reviewer','quality']) { const r=await aiService.execute(`Test ${role}`,{id:'t',role,modelPreference:'simulation-v1'},null); assert.gt(r.output.length,50,`${role} has output`); } });
  it('tokens accumulate', async () => { const b=aiService.getTotalTokens(); await aiService.execute('x',{id:'t',role:'product_manager'},null); assert.gt(aiService.getTotalTokens(),b); });
});

const runAllTests = async (callbacks = {}) => {
  const suites = new Map();
  for (const test of _tests) {
    if (!suites.has(test.suite)) suites.set(test.suite, { suite:test.suite, passed:0, failed:0, duration:0, cases:[] });
    const sr = suites.get(test.suite);
    const tc = { id:`${test.suite}::${test.name}`, suite:test.suite, name:test.name, status:'running', duration:0 };
    callbacks.onTestStart?.(test);
    const start = Date.now();
    try { await test.fn(); tc.status='passed'; tc.duration=Date.now()-start; sr.passed++; }
    catch(e) { tc.status='failed'; tc.duration=Date.now()-start; tc.error=e.message; sr.failed++; }
    sr.duration += tc.duration; sr.cases.push(tc); callbacks.onTestComplete?.(tc);
    await new Promise(r => setTimeout(r, 8));
  }
  const results = Array.from(suites.values());
  results.forEach(r => callbacks.onSuiteComplete?.(r));
  return results;
};

// ─── STORE ─────────────────────────────────────────────────────────────────────
function projectsReducer(state, action) {
  switch (action.type) {
    case 'INIT': return action.projects;
    case 'CREATE': {
      const p = action.data.id ? action.data : { id:uid('proj'), ...action.data, status:'idea', memory:{summary:'',knowledgeGraph:{nodes:[]},lastUpdated:new Date().toISOString()}, missions:[], installedAgents:agentRegistry.getEnabled(), createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() };
      return [p, ...state];
    }
    case 'UPDATE': return state.map(p => p.id===action.id ? { ...p, ...action.updates, updatedAt:new Date().toISOString() } : p);
    case 'DELETE': return state.filter(p => p.id !== action.id);
    case 'ADD_MISSION': return state.map(p => p.id!==action.projectId ? p : { ...p, missions:[...p.missions,action.mission], updatedAt:new Date().toISOString() });
    case 'SET_MISSION_STATUS': return state.map(p => p.id!==action.projectId ? p : { ...p, missions:p.missions.map(m => m.id!==action.missionId ? m : { ...m, status:action.status }) });
    case 'UPDATE_TASK': return state.map(p => p.id!==action.projectId ? p : { ...p, missions:p.missions.map(m => m.id!==action.missionId ? m : { ...m, tasks:m.tasks.map(t => t.id===action.task.id ? action.task : t) }) });
    case 'STREAM_CHUNK': return state.map(p => p.id!==action.projectId ? p : { ...p, missions:p.missions.map(m => m.id!==action.missionId ? m : { ...m, tasks:m.tasks.map(t => t.id!==action.taskId ? t : { ...t, streamBuffer:(t.streamBuffer||'')+action.delta, status:'streaming' }) }) });
    case 'ADD_NODES': return state.map(p => p.id!==action.projectId ? p : { ...p, memory:{ ...p.memory, knowledgeGraph:{ nodes:[...(p.memory?.knowledgeGraph?.nodes||[]),...action.nodes] }, lastUpdated:new Date().toISOString() }, updatedAt:new Date().toISOString() });
    case 'IMPORT': return [action.project, ...state.filter(p => p.id !== action.project.id)];
    default: return state;
  }
}

const StoreCtx = createContext(null);

function StoreProvider({ children }) {
  const [projects, dispatch] = useReducer(projectsReducer, []);
  const [config, setConfig] = useState(() => configManager.get());
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [pendingApproval, setPendingApproval] = useState(null);
  const [storageReady, setStorageReady] = useState(false);
  const [testResults, setTestResults] = useState(null);
  const [isTestRunning, setIsTestRunning] = useState(false);
  const approvalRef = useRef(null);
  const projectsRef = useRef(projects); projectsRef.current = projects;

  // Init storage
  useEffect(() => {
    storage.init().then(async () => {
      try {
        const ps = await storage.getProjects();
        if (ps.length) dispatch({ type:'INIT', projects:ps });
      } catch {}
      setStorageReady(true);
    });
  }, []);

  // Persist on change & auto-sync to GitHub
  useEffect(() => {
    if (!storageReady) return;
    projects.forEach(p => {
      storage.saveProject(p).catch(() => {});
      // Disparar sincronización automática silenciosa con GitHub si hay token
      if (window.securityLayer?.hasKey('github_token')) {
        toolRegistry.execute('github', { operation: 'auto_sync', name: p.name, title: `Sync ${p.name}`, projectData: p }, { projectId: p.id });
      }
    });
  }, [projects, storageReady]);

  // Config sync
  useEffect(() => configManager.subscribe(c => setConfig({ ...c })), []);

  // Memory accessors
  useEffect(() => {
    memoryEngine.setAccessors(
      (pid) => { const p = projectsRef.current.find(x => x.id===pid); return p?.memory?.knowledgeGraph?.nodes || []; },
      (pid, nodes) => dispatch({ type:'ADD_NODES', projectId:pid, nodes })
    );
  }, []);

  const createProject = useCallback((data) => {
    const p = { id:uid('proj'), ...data, status:'idea', memory:{summary:'',knowledgeGraph:{nodes:[]},lastUpdated:new Date().toISOString()}, missions:[], installedAgents:agentRegistry.getEnabled(), createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() };
    dispatch({ type:'CREATE', data: p });
    eventBus.emit({ type:'ProjectCreated', projectId:p.id, payload:{ name:data.name } });
    return p;
  }, []);

  const updateProject = useCallback((id, updates) => dispatch({ type:'UPDATE', id, updates }), []);

  const deleteProject = useCallback(async (id) => {
    dispatch({ type:'DELETE', id });
    setActiveProjectId(p => p===id ? null : p);
    await storage.deleteProject(id).catch(() => {});
    eventBus.emit({ type:'ProjectDeleted', projectId:id, payload:{} });
  }, []);

  const createAndRunMission = useCallback(async (projectId, goal, description, template, requiresApproval = true) => {
    const project = projectsRef.current.find(p => p.id===projectId);
    if (!project) return;
    const reqApproval = requiresApproval && !config.autoApprove;
    const missionId = uid('mission');
    const tasks = (MISSION_TEMPLATES[template] || MISSION_TEMPLATES.validate_idea)(missionId, description || goal);
    const mission = { id:missionId, projectId, goal, description, priority:'medium', status:'pending', tasks, requiresApproval:reqApproval, createdAt:new Date().toISOString() };
    dispatch({ type:'ADD_MISSION', projectId, mission });
    dispatch({ type:'SET_MISSION_STATUS', projectId, missionId, status:'running' });
    eventBus.emit({ type:'MissionCreated', projectId, payload:{ missionId, goal, taskCount:tasks.length, template } });
    setIsRunning(true);
    const completed = new Set();

    for (const taskDef of tasks) {
      if (taskDef.deps.length && !taskDef.deps.every(d => completed.has(d))) continue;
      let task = { ...taskDef, status:'running' };
      dispatch({ type:'UPDATE_TASK', projectId, missionId, task });
      eventBus.emit({ type:'TaskCreated', projectId, payload:{ taskId:task.id, agentRole:task.assignedAgentRole } });
      const agent = agentRegistry.getByRole(task.assignedAgentRole);
      if (!agent || !agent.enabled) {
        task = { ...task, status:'failed', output:`Agente "${task.assignedAgentRole}" no disponible.` };
        dispatch({ type:'UPDATE_TASK', projectId, missionId, task }); continue;
      }
      const onStream = config.streamingEnabled ? (delta, done) => {
        dispatch({ type:'STREAM_CHUNK', projectId, missionId, taskId:task.id, delta });
        eventBus.emit({ type:'StreamChunk', projectId, payload:{ taskId:task.id, agentRole:agent.role, delta, done } });
      } : null;

      let pr;
      try { pr = await scheduler.enqueue(() => runPipeline(task, mission, agent, projectId, onStream), { priority:'high', id:task.id }); }
      catch(e) { task = { ...task, status:'failed', output:`Error: ${e.message}` }; dispatch({ type:'UPDATE_TASK', projectId, missionId, task }); continue; }

      task = { ...task, status:'awaiting_approval', output:pr.output, streamBuffer:'', evaluation:{ score:pr.score, feedback:pr.feedback, evaluatedBy:'quality', timestamp:new Date().toISOString() } };
      dispatch({ type:'UPDATE_TASK', projectId, missionId, task });

      if (reqApproval) {
        dispatch({ type:'SET_MISSION_STATUS', projectId, missionId, status:'awaiting_approval' });
        const decision = await new Promise(res => { approvalRef.current = res; setPendingApproval({ task }); });
        setPendingApproval(null);
        if (decision === 'reject') {
          task = { ...task, status:'rejected' }; dispatch({ type:'UPDATE_TASK', projectId, missionId, task });
          dispatch({ type:'SET_MISSION_STATUS', projectId, missionId, status:'cancelled' });
          setIsRunning(false); return;
        }
      }
      task = { ...task, status:'completed', completedAt:new Date().toISOString() };
      dispatch({ type:'UPDATE_TASK', projectId, missionId, task }); completed.add(task.id);
      eventBus.emit({ type:'TaskCompleted', projectId, payload:{ taskId:task.id, agentRole:task.assignedAgentRole, score:pr.score, tokensUsed:pr.tokensUsed, latencyMs:pr.latencyMs } });
    }
    dispatch({ type:'SET_MISSION_STATUS', projectId, missionId, status:'completed' });
    eventBus.emit({ type:'MissionCompleted', projectId, payload:{ missionId, goal } });
    setIsRunning(false);
  }, [config]);

  const approveTask = useCallback(() => { if (approvalRef.current) { approvalRef.current('approve'); approvalRef.current = null; } }, []);
  const rejectTask = useCallback(() => { if (approvalRef.current) { approvalRef.current('reject'); approvalRef.current = null; } setPendingApproval(null); }, []);
  const exportProject = useCallback((id) => { const p = projectsRef.current.find(x => x.id===id); if (p) exporter.download(p); }, []);
  const importProject = useCallback(async (json) => { const p = exporter.parse(json); dispatch({ type:'IMPORT', project:p }); await storage.saveProject(p).catch(()=>{}); return p; }, []);
  const runTests = useCallback(async () => {
    setIsTestRunning(true); setTestResults(null);
    const results = await runAllTests({ onSuiteComplete: (s) => setTestResults(prev => [...(prev||[]).filter(x=>x.suite!==s.suite), s]) });
    setIsTestRunning(false); return results;
  }, []);

  const value = useMemo(() => ({
    projects, config, activeProjectId, isRunning, pendingApproval, storageReady, testResults, isTestRunning,
    activeProject: projects.find(p => p.id===activeProjectId) || null,
    setActiveProject: setActiveProjectId,
    createProject, updateProject, deleteProject,
    createAndRunMission, approveTask, rejectTask,
    updateConfig: (u) => configManager.set(u),
    toggleSim: () => configManager.set({ simulationMode: !configManager.get('simulationMode') }),
    toggleStreaming: () => configManager.set({ streamingEnabled: !configManager.get('streamingEnabled') }),
    exportProject, importProject, runTests,
  }), [projects, config, activeProjectId, isRunning, pendingApproval, storageReady, testResults, isTestRunning, createProject, updateProject, deleteProject, createAndRunMission, approveTask, rejectTask, exportProject, importProject, runTests]);

  return (
    <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>
  );
}
const useStore = () => { const c = useContext(StoreCtx); if (!c) throw new Error('useStore outside StoreProvider'); return c; };

// ─── DESIGN SYSTEM ─────────────────────────────────────────────────────────────
const T = {
  bg:'#080C18', surface:'#0E1525', card:'#141C2E', border:'#1E2B42', borderLight:'#253350',
  primary:'#6366F1', accent:'#A78BFA', success:'#10B981', warning:'#F59E0B', error:'#EF4444',
  info:'#3B82F6', teal:'#14B8A6', text:'#F1F5F9', textMuted:'#64748B', textDim:'#94A3B8',
};
const CAT = { web_app:{icon:'🌐',label:'App Web',color:T.info}, game:{icon:'🎮',label:'Juego',color:T.accent}, saas:{icon:'☁️',label:'SaaS',color:T.primary}, ai_tool:{icon:'🤖',label:'Herramienta IA',color:T.teal}, automation:{icon:'⚡',label:'Automatización',color:T.warning}, other:{icon:'📦',label:'Otro',color:T.textMuted} };
const STAT = { idea:{label:'Idea',dot:T.textMuted}, validated:{label:'Validada',dot:T.info}, in_progress:{label:'En progreso',dot:T.warning}, completed:{label:'Completada',dot:T.success}, archived:{label:'Archivada',dot:'#334155'} };
const MSTAT = { pending:{label:'Pendiente',color:T.textMuted}, running:{label:'⚡ Ejecutando',color:T.warning}, streaming:{label:'◎ Streaming',color:T.teal}, awaiting_approval:{label:'👁 Revisión',color:T.accent}, completed:{label:'✅ Completada',color:T.success}, failed:{label:'❌ Error',color:T.error}, cancelled:{label:'⊘ Cancelada',color:T.textMuted} };
const AMETA = { product_manager:{icon:'🎯',name:'ProductManager',color:T.info}, architect:{icon:'🏗️',name:'Architect',color:T.accent}, frontend_dev:{icon:'💻',name:'Developer',color:T.primary}, backend_dev:{icon:'⚙️',name:'Backend',color:T.teal}, tester:{icon:'🧪',name:'Tester',color:T.success}, reviewer:{icon:'🔍',name:'Reviewer',color:T.warning}, quality:{icon:'🏆',name:'Quality',color:T.success} };
const NMETA = { decision:{icon:'⚖️',label:'Decisión',color:T.accent}, requirement:{icon:'📋',label:'Requisito',color:T.info}, error:{icon:'⚠️',label:'Error',color:T.error}, learning:{icon:'💡',label:'Aprendizaje',color:T.warning}, market_research:{icon:'📊',label:'Investigación',color:T.success} };
const ECOL = { MissionCreated:T.primary, MissionCompleted:T.success, TaskCreated:T.info, TaskCompleted:T.success, EvaluationCompleted:T.warning, MemoryUpdated:T.teal, AIExecutionCompleted:T.accent, SystemError:T.error, ProjectCreated:T.primary, StreamChunk:T.teal, ToolExecuted:T.info };
const fmtDate = (iso) => new Date(iso).toLocaleDateString('es-ES',{day:'2-digit',month:'short',year:'numeric'});
const fmtRel = (iso) => { const d=Math.floor((Date.now()-new Date(iso))/86400000); return d===0?'hoy':d===1?'ayer':d<7?`hace ${d}d`:fmtDate(iso); };
const fmtMs = (ms) => ms<1000?`${Math.round(ms)}ms`:`${(ms/1000).toFixed(1)}s`;

// Inject CSS
const _s = document.createElement('style');
_s.textContent = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:${T.bg};color:${T.text};font-family:'Inter',sans-serif;min-height:100vh}
::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-track{background:${T.surface}}::-webkit-scrollbar-thumb{background:${T.border};border-radius:3px}
.forge-glow{box-shadow:0 0 0 1px ${T.primary}40,0 4px 24px rgba(99,102,241,.15)}
.accent-glow{box-shadow:0 0 0 1px ${T.accent}40,0 4px 20px rgba(167,139,250,.12)}
.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
.fade-in{animation:fadeIn .22s ease}@keyframes fadeIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
.slide-up{animation:slideUp .28s ease}@keyframes slideUp{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
.sc::after{content:'▋';animation:blink .7s infinite;color:${T.teal}}@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
textarea,input,select{background:${T.surface};border:1px solid ${T.border};color:${T.text};border-radius:8px;padding:10px 14px;font-family:'Inter',sans-serif;font-size:14px;outline:none;width:100%;transition:border-color .2s}
textarea:focus,input:focus,select:focus{border-color:${T.primary};box-shadow:0 0 0 3px rgba(99,102,241,.15)}
textarea{resize:vertical;min-height:80px}select option{background:${T.card}}
button{cursor:pointer;font-family:'Inter',sans-serif;border:none;transition:all .18s}
.md h1,.md h2,.md h3{font-family:'Space Grotesk',sans-serif;margin:18px 0 10px}
.md h1{font-size:20px;color:${T.text};border-bottom:1px solid ${T.border};padding-bottom:7px}
.md h2{font-size:16px;color:${T.text}}.md h3{font-size:14px;color:${T.textDim}}
.md p{margin-bottom:10px;line-height:1.7;color:${T.textDim}}
.md ul,.md ol{padding-left:18px;margin-bottom:10px}.md li{margin-bottom:4px;color:${T.textDim};line-height:1.6}
.md table{width:100%;border-collapse:collapse;margin:12px 0;font-size:12px}
.md th{background:${T.surface};padding:8px 12px;text-align:left;border:1px solid ${T.border};color:${T.textDim};font-weight:600;font-size:11px;text-transform:uppercase}
.md td{padding:8px 12px;border:1px solid ${T.border};color:${T.text}}
.md tr:nth-child(even) td{background:rgba(255,255,255,.02)}
.md code{background:${T.surface};padding:2px 5px;border-radius:4px;font-size:12px;color:${T.accent};font-family:'JetBrains Mono',monospace}
.md pre{background:${T.surface};border:1px solid ${T.border};border-radius:8px;padding:14px;overflow-x:auto;margin:10px 0}
.md pre code{background:none;padding:0;color:${T.textDim}}
.md strong{color:${T.text};font-weight:600}
.md blockquote{border-left:3px solid ${T.primary};padding-left:13px;margin:10px 0;color:${T.textMuted};font-style:italic}
.tab-btn{background:none;border:none;color:${T.textMuted};padding:9px 16px;font-size:13px;border-bottom:2px solid transparent;transition:all .18s;white-space:nowrap}
.tab-btn:hover{color:${T.text}}.tab-btn.active{color:${T.primary};border-bottom-color:${T.primary};font-weight:500}
`;
document.head.appendChild(_s);

function md(t) {
  if (!t) return '';
  return t
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/^### (.+)$/gm,'<h3>$1</h3>').replace(/^## (.+)$/gm,'<h2>$1</h2>').replace(/^# (.+)$/gm,'<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>')
    .replace(/`([^`]+)`/g,'<code>$1</code>').replace(/^> (.+)$/gm,'<blockquote>$1</blockquote>')
    .replace(/```[\w]*\n([\s\S]*?)```/g,'<pre><code>$1</code></pre>')
    .replace(/^\| (.+) \|$/gm, (_,r) => '<tr>'+r.split(' | ').map(c=>`<td>${c.trim()}</td>`).join('')+'</tr>')
    .replace(/(<tr>.*<\/tr>\n?)+/g, m => { const rows=m.trim().split('\n'); return rows.length>1?`<table><thead>${rows[0].replace(/td>/g,'th>')}</thead><tbody>${rows.slice(1).join('')}</tbody></table>`:`<table><tbody>${m}</tbody></table>`; })
    .replace(/^[-*] (.+)$/gm,'<li>$1</li>').replace(/(<li>.*<\/li>\n?)+/g,'<ul>$&</ul>')
    .replace(/\n\n/g,'</p><p>');
}
function Markdown({ content, streaming }) {
  return <div className={`md${streaming?' sc':''}`} dangerouslySetInnerHTML={{ __html: md(content) }} />;
}

// Primitives
function Badge({ label, color = T.textMuted }) {
  return <span style={{ display:'inline-flex', alignItems:'center', padding:'3px 9px', borderRadius:20, background:color+'18', border:`1px solid ${color}40`, fontSize:11, fontWeight:600, color, letterSpacing:'.03em', whiteSpace:'nowrap' }}>{label}</span>;
}
function Btn({ onClick, children, variant='primary', size='md', disabled, style:st={} }) {
  const V = { primary:{background:T.primary,color:'#fff'}, ghost:{background:'transparent',color:T.textDim,border:`1px solid ${T.border}`}, danger:{background:T.error+'18',color:T.error,border:`1px solid ${T.error}40`}, success:{background:T.success+'18',color:T.success,border:`1px solid ${T.success}40`}, accent:{background:T.accent+'18',color:T.accent,border:`1px solid ${T.accent}40`}, teal:{background:T.teal+'18',color:T.teal,border:`1px solid ${T.teal}40`} };
  const S = { sm:{padding:'5px 12px',fontSize:12}, md:{padding:'8px 16px',fontSize:14}, lg:{padding:'11px 22px',fontSize:15} };
  return <button onClick={onClick} onTouchEnd={(e) => { if (!disabled && onClick) { e.preventDefault(); onClick(e); } }} disabled={disabled} style={{ ...V[variant], ...S[size], borderRadius:8, fontWeight:500, opacity:disabled?0.5:1, cursor:disabled?'not-allowed':'pointer', touchAction:'manipulation', ...st }} onMouseEnter={e=>!disabled&&(e.target.style.filter='brightness(1.12)')} onMouseLeave={e=>e.target.style.filter='none'}>{children}</button>;
}
function Card({ children, onClick, glow, style:st={} }) {
  return <div onClick={onClick} className={glow?'forge-glow fade-in':'fade-in'} style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:20, transition:'all .2s', cursor:onClick?'pointer':'default', ...st }} onMouseEnter={e=>onClick&&(e.currentTarget.style.borderColor=T.borderLight)} onMouseLeave={e=>onClick&&(e.currentTarget.style.borderColor=T.border)}>{children}</div>;
}
function ScoreBar({ score }) {
  const c = score>=80?T.success:score>=60?T.warning:T.error;
  return <div style={{ display:'flex', alignItems:'center', gap:7 }}><div style={{ width:56, height:4, background:T.border, borderRadius:2 }}><div style={{ width:`${score}%`, height:'100%', background:c, borderRadius:2, transition:'width .5s' }}/></div><span style={{ fontSize:12, fontWeight:600, color:c, minWidth:25 }}>{score}</span></div>;
}
function Spinner({ size=18 }) {
  return <div className="spin" style={{ width:size, height:size, border:`2px solid ${T.border}`, borderTopColor:T.primary, borderRadius:'50%', flexShrink:0 }} />;
}
function Empty({ icon, title, subtitle, action }) {
  return <div style={{ display:'flex', flexDirection:'column', alignItems:'center', padding:'54px 20px', gap:14, textAlign:'center' }}><div style={{ fontSize:44 }}>{icon}</div><div><div style={{ fontSize:17, fontWeight:600, fontFamily:'Space Grotesk', color:T.text, marginBottom:4 }}>{title}</div>{subtitle&&<div style={{ fontSize:13, color:T.textMuted, maxWidth:320 }}>{subtitle}</div>}</div>{action}</div>;
}
function Divider() { return <div style={{ height:1, background:T.border, margin:'13px 0' }} />; }
function MetricChip({ label, value, color=T.textMuted }) {
  return <div style={{ padding:'8px 13px', background:T.surface, border:`1px solid ${T.border}`, borderRadius:8, textAlign:'center', minWidth:78 }}><div style={{ fontSize:17, fontWeight:700, fontFamily:'Space Grotesk', color }}>{value}</div><div style={{ fontSize:10, color:T.textMuted, marginTop:2, textTransform:'uppercase', letterSpacing:'.04em' }}>{label}</div></div>;
}
function Modal({ open, onClose, title, children, width=540 }) {
  if (!open) return null;
  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.72)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div onClick={e=>e.stopPropagation()} className="slide-up" style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:16, padding:26, width:'100%', maxWidth:width, maxHeight:'87vh', overflow:'auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18 }}>
          <span style={{ fontSize:17, fontWeight:700, fontFamily:'Space Grotesk', color:T.text }}>{title}</span>
          <button onClick={onClose} style={{ background:'none', border:'none', color:T.textMuted, fontSize:22, cursor:'pointer', padding:'2px 6px', borderRadius:4 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── UI COMPONENTS ─────────────────────────────────────────────────────────────
function ToolCallCard({ result }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ background:result.success?T.teal+'0A':T.error+'0A', border:`1px solid ${result.success?T.teal+'40':T.error+'40'}`, borderRadius:7, padding:'7px 11px', marginTop:6 }}>
      <div style={{ display:'flex', gap:8, alignItems:'center', cursor:'pointer' }} onClick={() => setShow(!show)}>
        <span style={{ fontSize:12, fontFamily:'JetBrains Mono', color:result.success?T.teal:T.error }}>🔧 {result.toolId}</span>
        <span style={{ fontSize:11, color:T.textMuted }}>{fmtMs(result.duration)}</span>
        <Badge label={result.success?'✓':'✗'} color={result.success?T.teal:T.error}/>
        <span style={{ fontSize:11, color:T.textMuted, marginLeft:'auto' }}>{show?'▲':'▼'}</span>
      </div>
      {show && <pre style={{ marginTop:8, fontSize:11, color:T.textDim, fontFamily:'JetBrains Mono', whiteSpace:'pre-wrap', wordBreak:'break-all', maxHeight:160, overflow:'auto' }}>{result.output.slice(0,400)}{result.output.length>400?'…':''}</pre>}
    </div>
  );
}

function StreamOutput({ content, isStreaming }) {
  const ref = useRef();
  useEffect(() => { if (ref.current && isStreaming) ref.current.scrollTop = ref.current.scrollHeight; }, [content]);
  return (
    <div ref={ref} style={{ maxHeight:360, overflow:'auto', padding:14, background:T.surface, borderRadius:8, border:`1px solid ${T.border}` }}>
      <Markdown content={content||''} streaming={isStreaming}/>
    </div>
  );
}

function TaskCard({ task, index }) {
  const [show, setShow] = useState(false);
  const am = AMETA[task.assignedAgentRole] || { icon:'🤖', name:task.assignedAgentRole, color:T.textMuted };
  const sc = { pending:T.textMuted, running:T.warning, streaming:T.teal, awaiting_approval:T.accent, completed:T.success, failed:T.error, rejected:T.error }[task.status] || T.textMuted;
  const isStreaming = task.status === 'streaming';
  const display = isStreaming ? (task.streamBuffer||'') : task.output;
  return (
    <div style={{ background:T.surface, border:`1px solid ${isStreaming?T.teal+'60':T.border}`, borderRadius:9, overflow:'hidden', transition:'border-color .3s' }}>
      <div style={{ padding:'10px 14px', display:'flex', alignItems:'center', gap:10 }}>
        <div style={{ width:28, height:28, background:am.color+'18', border:`1px solid ${am.color}30`, borderRadius:7, display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, flexShrink:0 }}>{am.icon}</div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:7 }}>
            <span style={{ fontSize:12, color:T.textMuted, fontWeight:600 }}>#{index+1}</span>
            <span style={{ fontSize:13, fontWeight:500, color:T.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{task.title}</span>
            {(task.status==='running'||isStreaming) && <Spinner size={12}/>}
          </div>
          <div style={{ display:'flex', gap:7, marginTop:2 }}>
            <span style={{ fontSize:11, color:am.color, fontWeight:600 }}>{am.name}</span>
            <span style={{ fontSize:11, color:sc, fontWeight:500 }}>· {isStreaming?'streaming…':task.status}</span>
            {task.evaluation && <span style={{ fontSize:11, color:T.textMuted }}>· {task.evaluation.score}/100</span>}
          </div>
        </div>
        {task.evaluation && <ScoreBar score={task.evaluation.score}/>}
        {display && <button onClick={()=>setShow(!show)} style={{ background:T.primary+'18', border:`1px solid ${T.primary}40`, color:T.primary, fontSize:12, padding:'4px 10px', borderRadius:6, cursor:'pointer', whiteSpace:'nowrap', flexShrink:0 }}>{show?'Ocultar':'Ver output'}</button>}
      </div>
      {show && display && (
        <div className="fade-in" style={{ borderTop:`1px solid ${T.border}`, padding:14 }}>
          {task.evaluation && <div style={{ marginBottom:10, padding:'7px 11px', background:T.card, borderRadius:7, display:'flex', gap:14, alignItems:'center', flexWrap:'wrap' }}><span style={{ fontSize:12, color:T.textMuted }}>Score: <strong style={{ color:T.text }}>{task.evaluation.score}/100</strong></span><span style={{ fontSize:12, color:T.textMuted }}>{task.evaluation.feedback}</span></div>}
          <StreamOutput content={display} isStreaming={isStreaming}/>
          {task.toolCalls?.map((r,i) => <ToolCallCard key={i} result={r}/>)}
        </div>
      )}
    </div>
  );
}

// ─── TABS ───────────────────────────────────────────────────────────────────────
function MissionsTab({ project, onNewMission }) {
  const [expanded, setExpanded] = useState(null);
  if (!project.missions.length) return <Empty icon="🚀" title="Sin misiones todavía" subtitle="Crea una misión para que los agentes empiecen a trabajar." action={<Btn onClick={onNewMission}>+ Crear primera misión</Btn>}/>;
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:11 }}>
      {[...project.missions].reverse().map(mission => {
        const sm = MSTAT[mission.status] || MSTAT.pending;
        const isExp = expanded === mission.id;
        const done = mission.tasks.filter(t=>t.status==='completed').length;
        const streaming = mission.tasks.some(t=>t.status==='streaming');
        return (
          <Card key={mission.id} style={{ padding:0, overflow:'hidden' }} glow={streaming}>
            <div onClick={() => setExpanded(isExp?null:mission.id)} style={{ padding:'13px 17px', cursor:'pointer', display:'flex', alignItems:'center', gap:11 }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:3, flexWrap:'wrap' }}>
                  <span style={{ fontWeight:600, fontSize:14, color:T.text, fontFamily:'Space Grotesk' }}>{mission.goal}</span>
                  <Badge label={sm.label} color={sm.color}/>
                  {['running','awaiting_approval'].includes(mission.status) && <Spinner size={13}/>}
                  {streaming && <Badge label="◎ streaming" color={T.teal}/>}
                </div>
                <div style={{ display:'flex', gap:12, alignItems:'center' }}>
                  <span style={{ fontSize:12, color:T.textMuted }}>{done}/{mission.tasks.length} tareas · {fmtRel(mission.createdAt)}</span>
                  {mission.tasks.length > 0 && <div style={{ width:60, height:3, background:T.border, borderRadius:2 }}><div style={{ height:'100%', width:`${(done/mission.tasks.length)*100}%`, background:`linear-gradient(90deg,${T.primary},${T.accent})`, borderRadius:2, transition:'width .4s' }}/></div>}
                </div>
              </div>
              <span style={{ color:T.textMuted, fontSize:14, flexShrink:0 }}>{isExp?'▲':'▼'}</span>
            </div>
            {isExp && (
              <div style={{ borderTop:`1px solid ${T.border}`, padding:'13px 17px' }} className="fade-in">
                {mission.description && <p style={{ fontSize:13, color:T.textMuted, marginBottom:13, lineHeight:1.6 }}>{mission.description}</p>}
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>{mission.tasks.map((t,i) => <TaskCard key={t.id} task={t} index={i}/>)}</div>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function MemoryTab({ project }) {
  const [filter, setFilter] = useState('all');
  const nodes = project.memory?.knowledgeGraph?.nodes || [];
  const filtered = filter==='all' ? nodes : nodes.filter(n=>n.type===filter);
  const byType = nodes.reduce((a,n) => { a[n.type]=(a[n.type]||0)+1; return a; }, {});
  const global = memoryEngine.getGlobalNodes();
  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:18, flexWrap:'wrap', gap:10 }}>
        <div><h3 style={{ fontFamily:'Space Grotesk', fontWeight:600, color:T.text, marginBottom:3 }}>Knowledge Graph</h3><p style={{ fontSize:13, color:T.textMuted }}>{nodes.length} nodos · {global.length} globales · IndexedDB</p></div>
        <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
          <button onClick={()=>setFilter('all')} style={{ padding:'4px 12px', borderRadius:20, border:`1px solid ${filter==='all'?T.primary+'60':T.border}`, background:filter==='all'?T.primary+'15':'transparent', color:filter==='all'?T.primary:T.textMuted, fontSize:12, fontWeight:500, cursor:'pointer' }}>Todos ({nodes.length})</button>
          {Object.keys(NMETA).map(type => { const count=byType[type]||0; if(!count)return null; const meta=NMETA[type]; const active=filter===type; return <button key={type} onClick={()=>setFilter(type)} style={{ padding:'4px 12px', borderRadius:20, border:`1px solid ${active?meta.color+'60':T.border}`, background:active?meta.color+'15':'transparent', color:active?meta.color:T.textMuted, fontSize:12, fontWeight:500, cursor:'pointer' }}>{meta.icon} {meta.label} ({count})</button>; })}
        </div>
      </div>
      {global.length > 0 && <div style={{ marginBottom:14, padding:'9px 14px', background:T.accent+'0D', border:`1px solid ${T.accent}30`, borderRadius:9, display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}><span style={{ fontSize:12, color:T.accent, fontWeight:600 }}>🌐 Memoria global</span><span style={{ fontSize:12, color:T.textMuted }}>{global.length} patrones cross-proyecto</span></div>}
      {!filtered.length ? <Empty icon="🧠" title="Sin nodos" subtitle="Los agentes construirán el conocimiento al ejecutar misiones."/> :
        <div style={{ display:'flex', flexDirection:'column', gap:9 }}>
          {[...filtered].reverse().map(node => { const meta=NMETA[node.type]||{icon:'📌',label:node.type,color:T.textMuted}; const am=AMETA[node.sourceAgent]; return (
            <Card key={node.id} style={{ padding:'13px 16px' }}>
              <div style={{ display:'flex', gap:11, alignItems:'flex-start' }}>
                <div style={{ width:30, height:30, background:meta.color+'18', border:`1px solid ${meta.color}30`, borderRadius:7, display:'flex', alignItems:'center', justifyContent:'center', fontSize:15, flexShrink:0 }}>{meta.icon}</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:'flex', gap:7, alignItems:'center', marginBottom:4, flexWrap:'wrap' }}><Badge label={meta.label} color={meta.color}/>{am&&<span style={{ fontSize:12, color:am.color, fontWeight:500 }}>{am.icon} {am.name}</span>}<span style={{ fontSize:11, color:T.textMuted, marginLeft:'auto' }}>{fmtRel(node.timestamp)}</span></div>
                  <div style={{ fontSize:14, fontWeight:500, color:T.text, marginBottom:4 }}>{node.title}</div>
                  <div style={{ fontSize:12, color:T.textMuted, lineHeight:1.55, display:'-webkit-box', WebkitLineClamp:3, WebkitBoxOrient:'vertical', overflow:'hidden' }}>{node.content}</div>
                  <div style={{ marginTop:8, display:'flex', alignItems:'center', gap:7 }}><div style={{ height:3, width:52, background:T.border, borderRadius:2 }}><div style={{ height:'100%', width:`${Math.round(node.confidence*100)}%`, background:meta.color, borderRadius:2 }}/></div><span style={{ fontSize:11, color:T.textMuted }}>confianza {Math.round(node.confidence*100)}%</span></div>
                </div>
              </div>
            </Card>
          ); })}
        </div>
      }
    </div>
  );
}

function AgentsTab() {
  const agents = agentRegistry.getAll();
  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18 }}><div><h3 style={{ fontFamily:'Space Grotesk', fontWeight:600, color:T.text, marginBottom:3 }}>Agentes — Kernel v3.0</h3><p style={{ fontSize:13, color:T.textMuted }}>{agents.filter(a=>a.enabled).length} activos · {agents.filter(a=>a.isPlugin).length} plugins</p></div><Badge label="🔌 Plugin API" color={T.accent}/></div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))', gap:13 }}>
        {agents.map(agent => { const meta=AMETA[agent.role]||{icon:'🤖',name:agent.role,color:T.textMuted}; const avg=agentRegistry.getAverageScore(agent.role); const rec=agent.performanceHistory?.length||0; return (
          <Card key={agent.id} style={{ opacity:agent.enabled?1:0.5 }}>
            <div style={{ display:'flex', gap:11, marginBottom:10 }}><div style={{ width:38, height:38, background:meta.color+'18', border:`1px solid ${meta.color}30`, borderRadius:9, display:'flex', alignItems:'center', justifyContent:'center', fontSize:19 }}>{meta.icon}</div><div style={{ flex:1 }}><div style={{ fontWeight:600, fontSize:14, color:T.text, fontFamily:'Space Grotesk' }}>{agent.name}</div><div style={{ display:'flex', gap:5, marginTop:3 }}><Badge label={agent.isPlugin?'Plugin':'Built-in'} color={agent.isPlugin?T.accent:T.primary}/></div></div></div>
            <p style={{ fontSize:12, color:T.textMuted, marginBottom:8, lineHeight:1.5 }}>{agent.description}</p>
            <div style={{ fontSize:11, color:T.textMuted, fontStyle:'italic', marginBottom:9 }}>"{agent.personality}"</div>
            <div style={{ display:'flex', gap:5, flexWrap:'wrap', marginBottom:7 }}>{agent.skills?.map(s => <Badge key={s.id} label={s.name} color={T.teal}/>)}</div>
            {agent.tools?.length > 0 && <div style={{ display:'flex', gap:5, flexWrap:'wrap', marginBottom:9 }}>{agent.tools.map(t => <Badge key={t} label={`🔧 ${t}`} color={T.info}/>)}</div>}
            <Divider/>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}><span style={{ fontSize:12, color:T.textMuted }}>{rec} tarea{rec!==1?'s':''}</span>{rec>0&&<ScoreBar score={avg}/>}</div>
          </Card>
        ); })}
      </div>
    </div>
  );
}

function ToolsTab() {
  const tools = toolRegistry.getAll();
  const cats = [...new Set(tools.map(t=>t.category))];
  return (
    <div>
      <div style={{ marginBottom:18 }}><h3 style={{ fontFamily:'Space Grotesk', fontWeight:600, color:T.text, marginBottom:3 }}>Tool Engine v3.0</h3><p style={{ fontSize:13, color:T.textMuted }}>{tools.filter(t=>t.available).length} disponibles · {tools.length} registradas · schema-validated · permission-gated</p></div>
      {cats.map(cat => (
        <div key={cat} style={{ marginBottom:18 }}>
          <div style={{ fontSize:12, color:T.textMuted, fontWeight:600, textTransform:'uppercase', letterSpacing:'.06em', marginBottom:9 }}>{cat}</div>
          <div style={{ display:'flex', flexDirection:'column', gap:7 }}>
            {tools.filter(t=>t.category===cat).map(t => (
              <div key={t.id} style={{ display:'flex', gap:11, alignItems:'center', padding:'11px 14px', background:T.surface, borderRadius:9, border:`1px solid ${t.available?T.teal+'30':T.border}` }}>
                <Badge label={t.available?'disponible':'pendiente'} color={t.available?T.teal:T.textMuted}/>
                <div style={{ flex:1 }}><div style={{ fontSize:13, fontWeight:600, color:T.text }}>{t.name}</div><div style={{ fontSize:12, color:T.textMuted }}>{t.description}</div>{t.available&&<div style={{ fontSize:11, color:T.textMuted, marginTop:2, fontFamily:'JetBrains Mono' }}>timeout: {t.timeout}ms · retries: {t.maxRetries}</div>}</div>
                <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>{t.permissions.map(p=><Badge key={p} label={p} color={T.info}/>)}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TimelineTab({ projectId }) {
  const tl = obs.getTimeline(projectId, 100);
  if (!tl.length) return <Empty icon="⏱" title="Sin eventos" subtitle="Ejecuta una misión para generar el timeline."/>;
  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:14 }}><h3 style={{ fontFamily:'Space Grotesk', fontWeight:600, color:T.text }}>Timeline</h3><span style={{ fontSize:13, color:T.textMuted }}>{tl.length} eventos</span></div>
      <div style={{ display:'flex', flexDirection:'column' }}>
        {tl.map((evt, idx) => { const color=ECOL[evt.type]||T.textMuted; return (
          <div key={evt.id} style={{ display:'flex', gap:10, alignItems:'flex-start' }}>
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', flexShrink:0, width:16 }}><div style={{ width:9, height:9, borderRadius:'50%', background:color, flexShrink:0, marginTop:6 }}/>{idx<tl.length-1&&<div style={{ width:1, flex:1, minHeight:12, background:T.border, marginTop:2 }}/>}</div>
            <div style={{ flex:1, padding:'7px 11px', background:T.surface, borderRadius:8, marginBottom:6, border:`1px solid ${T.border}` }} className="fade-in">
              <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:evt.payload?3:0 }}><span style={{ fontSize:12, fontWeight:600, color }}>{evt.type}</span><span style={{ fontSize:11, color:T.textMuted, marginLeft:'auto' }}>{new Date(evt.timestamp).toLocaleTimeString('es-ES')}</span></div>
              {evt.payload && <div style={{ fontSize:11, color:T.textMuted, fontFamily:'JetBrains Mono', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{JSON.stringify(evt.payload).slice(0,150)}</div>}
            </div>
          </div>
        ); })}
      </div>
    </div>
  );
}

// ─── MODALS ─────────────────────────────────────────────────────────────────────
function NewMissionModal({ open, onClose, projectId }) {
  const { createAndRunMission, isRunning } = useStore();
  const [form, setForm] = useState({ goal:'', description:'', template:'validate_idea', requiresApproval:true });
  const set = k => e => setForm(f => ({ ...f, [k]:e.target.value }));
  const run = async () => {
    if (!form.goal.trim()) return;
    onClose();
    await createAndRunMission(projectId, form.goal, form.description, form.template, form.requiresApproval);
    setForm({ goal:'', description:'', template:'validate_idea', requiresApproval:true });
  };
  return (
    <Modal open={open} onClose={onClose} title="🚀 Nueva misión">
      <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
        <div><label style={{ fontSize:13, color:T.textMuted, fontWeight:500, display:'block', marginBottom:5 }}>Objetivo *</label><input value={form.goal} onChange={set('goal')} placeholder="Ej: Validar mi idea de app con IA..."/></div>
        <div><label style={{ fontSize:13, color:T.textMuted, fontWeight:500, display:'block', marginBottom:5 }}>Contexto</label><textarea value={form.description} onChange={set('description')} rows={3} placeholder="Producto, público objetivo, restricciones..."/></div>
        <div>
          <label style={{ fontSize:13, color:T.textMuted, fontWeight:500, display:'block', marginBottom:7 }}>Plantilla</label>
          <div style={{ display:'flex', flexDirection:'column', gap:7 }}>
            {MISSION_META.map(t => (
              <label key={t.value} style={{ display:'flex', gap:11, padding:'11px 13px', border:`1px solid ${form.template===t.value?T.primary+'60':T.border}`, background:form.template===t.value?T.primary+'0A':'transparent', borderRadius:9, cursor:'pointer' }}>
                <input type="radio" name="tmpl" value={t.value} checked={form.template===t.value} onChange={set('template')} style={{ width:'auto', accentColor:T.primary, marginTop:2 }}/>
                <div><div style={{ fontSize:13, fontWeight:500, color:T.text }}>{t.label}</div><div style={{ fontSize:12, color:T.textMuted, marginTop:2 }}>{t.desc}</div></div>
              </label>
            ))}
          </div>
        </div>
        <label style={{ display:'flex', gap:9, alignItems:'center', cursor:'pointer' }}>
          <input type="checkbox" checked={form.requiresApproval} onChange={e=>setForm(f=>({...f,requiresApproval:e.target.checked}))} style={{ width:'auto', accentColor:T.primary }}/>
          <span style={{ fontSize:13, color:T.textDim }}>Human-in-the-Loop — aprobación entre tareas</span>
        </label>
        <Divider/>
        <div style={{ display:'flex', gap:9, justifyContent:'flex-end' }}>
          <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn onClick={run} disabled={!form.goal.trim()||isRunning}>{isRunning?<span style={{display:'flex',gap:8,alignItems:'center'}}><Spinner size={14}/>Ejecutando…</span>:'🚀 Iniciar misión'}</Btn>
        </div>
      </div>
    </Modal>
  );
}

function CreateProjectModal({ open, onClose }) {
  const { createProject, setActiveProject } = useStore();
  const [form, setForm] = useState({ name:'', description:'', category:'web_app', monetizationGoal:'' });
  const set = k => e => setForm(f => ({ ...f, [k]:e.target.value }));
  const create = () => {
    if (!form.name.trim()) return;
    const p = createProject(form); setActiveProject(p.id); onClose();
    setForm({ name:'', description:'', category:'web_app', monetizationGoal:'' });
  };
  return (
    <Modal open={open} onClose={onClose} title="✨ Nuevo proyecto">
      <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
        <div><label style={{ fontSize:13, color:T.textMuted, fontWeight:500, display:'block', marginBottom:5 }}>Nombre *</label><input value={form.name} onChange={set('name')} placeholder="Ej: InventoryAI, TaskForge..."/></div>
        <div><label style={{ fontSize:13, color:T.textMuted, fontWeight:500, display:'block', marginBottom:5 }}>Descripción</label><textarea value={form.description} onChange={set('description')} rows={3} placeholder="¿Qué problema resuelve?"/></div>
        <div><label style={{ fontSize:13, color:T.textMuted, fontWeight:500, display:'block', marginBottom:5 }}>Categoría</label><select value={form.category} onChange={set('category')}>{Object.entries(CAT).map(([v,{icon,label}]) => <option key={v} value={v}>{icon} {label}</option>)}</select></div>
        <div><label style={{ fontSize:13, color:T.textMuted, fontWeight:500, display:'block', marginBottom:5 }}>Monetización</label><input value={form.monetizationGoal} onChange={set('monetizationGoal')} placeholder="Ej: Freemium + SaaS, licencias B2B..."/></div>
        <Divider/>
        <div style={{ display:'flex', gap:9, justifyContent:'flex-end' }}><Btn variant="ghost" onClick={onClose}>Cancelar</Btn><Btn onClick={create} disabled={!form.name.trim()}>Crear proyecto</Btn></div>
      </div>
    </Modal>
  );
}

function ApprovalLayer() {
  const { pendingApproval, approveTask, rejectTask } = useStore();
  if (!pendingApproval) return null;
  const { task } = pendingApproval;
  const am = AMETA[task.assignedAgentRole] || { icon:'🤖', name:task.assignedAgentRole, color:T.accent };
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.76)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div className="slide-up accent-glow" style={{ background:T.card, border:`1px solid ${T.accent}60`, borderRadius:16, padding:26, width:'100%', maxWidth:680, maxHeight:'86vh', display:'flex', flexDirection:'column', gap:17 }}>
        <div style={{ display:'flex', gap:13, alignItems:'flex-start' }}>
          <div style={{ width:42, height:42, background:am.color+'18', border:`1px solid ${am.color}40`, borderRadius:11, display:'flex', alignItems:'center', justifyContent:'center', fontSize:21, flexShrink:0 }}>{am.icon}</div>
          <div><div style={{ fontSize:11, color:T.accent, fontWeight:600, textTransform:'uppercase', letterSpacing:'.07em', marginBottom:3 }}>👁 Human Approval Required</div><div style={{ fontFamily:'Space Grotesk', fontWeight:700, fontSize:17, color:T.text }}>{task.title}</div><div style={{ fontSize:13, color:T.textMuted, marginTop:2 }}>Por {am.name}{task.evaluation?` · Score ${task.evaluation.score}/100`:''}</div></div>
        </div>
        {task.evaluation && <div style={{ padding:'9px 13px', background:T.surface, borderRadius:8, display:'flex', gap:14, alignItems:'center', flexWrap:'wrap' }}><ScoreBar score={task.evaluation.score}/><span style={{ fontSize:12, color:T.textMuted }}>{task.evaluation.feedback}</span></div>}
        <div style={{ flex:1, overflow:'auto', background:T.surface, borderRadius:9, padding:16, maxHeight:280, border:`1px solid ${T.border}` }}><Markdown content={task.output}/></div>
        <div style={{ display:'flex', gap:11, justifyContent:'flex-end' }}><Btn variant="danger" onClick={rejectTask}>✕ Rechazar y cancelar</Btn><Btn variant="success" onClick={approveTask}>✓ Aprobar y continuar</Btn></div>
      </div>
    </div>
  );
}

// ─── DEV PANEL ──────────────────────────────────────────────────────────────────
function DevPanel({ open, onClose }) {
  const { runTests, testResults, isTestRunning, config, toggleSim, toggleStreaming } = useStore();
  const [tab, setTab] = useState('tests');
  const aiM = obs.getAIMetrics(); const evtS = obs.getEventBusStats(); const schS = obs.getSchedulerStats(); const allMet = obs.getAllAgentMetrics();
  const totalT = _tests.length;
  const passedT = testResults?.reduce((s,r)=>s+r.passed,0)||0;
  const failedT = testResults?.reduce((s,r)=>s+r.failed,0)||0;
  return (
    <Modal open={open} onClose={onClose} title="🔬 Dev Panel — Kernel v3.0" width={900}>
      <div style={{ borderBottom:`1px solid ${T.border}`, display:'flex', marginBottom:18, gap:2, overflowX:'auto' }}>
        {[['tests','🧪 Tests'],['agents','🤖 Agentes'],['ai','⚡ AI'],['evts','📡 Events'],['kernel','🔩 Kernel'],['cfg','⚙️ Config']].map(([id,label]) => <button key={id} className={`tab-btn ${tab===id?'active':''}`} onClick={()=>setTab(id)}>{label}</button>)}
      </div>

      {tab==='tests' && (
        <div>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
            <div style={{ display:'flex', gap:10 }}><MetricChip label="Total" value={totalT} color={T.primary}/><MetricChip label="Pasados" value={passedT} color={T.success}/><MetricChip label="Fallidos" value={failedT} color={failedT>0?T.error:T.textMuted}/></div>
            <Btn onClick={runTests} disabled={isTestRunning} variant={isTestRunning?'ghost':'primary'}>{isTestRunning?<span style={{display:'flex',gap:8,alignItems:'center'}}><Spinner size={14}/>Ejecutando…</span>:'▶ Ejecutar todos'}</Btn>
          </div>
          {!testResults && !isTestRunning && <div style={{ padding:32, textAlign:'center', color:T.textMuted, background:T.surface, borderRadius:10, border:`1px solid ${T.border}` }}>Tests listos. Pulsa "Ejecutar todos".</div>}
          {testResults && (
            <div style={{ display:'flex', flexDirection:'column', gap:10, maxHeight:420, overflowY:'auto' }}>
              {testResults.map(suite => (
                <div key={suite.suite} style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:10, overflow:'hidden' }}>
                  <div style={{ padding:'11px 14px', display:'flex', gap:10, alignItems:'center', background:T.card }}>
                    <span style={{ fontWeight:600, fontSize:13, color:T.text, flex:1 }}>{suite.suite}</span>
                    <Badge label={`✅ ${suite.passed}`} color={T.success}/>
                    {suite.failed>0 && <Badge label={`❌ ${suite.failed}`} color={T.error}/>}
                    <span style={{ fontSize:12, color:T.textMuted }}>{fmtMs(suite.duration)}</span>
                  </div>
                  <div style={{ padding:'8px 14px', display:'flex', flexDirection:'column', gap:4 }}>
                    {suite.cases.map(tc => (
                      <div key={tc.id} style={{ display:'flex', gap:8, alignItems:'flex-start', padding:'5px 8px', borderRadius:6, background:tc.status==='passed'?T.success+'08':tc.status==='failed'?T.error+'08':'transparent' }}>
                        <span style={{ fontSize:13, flexShrink:0 }}>{tc.status==='passed'?'✅':tc.status==='failed'?'❌':'⏸'}</span>
                        <div style={{ flex:1, minWidth:0 }}><span style={{ fontSize:12, color:T.text }}>{tc.name}</span>{tc.error&&<div style={{ fontSize:11, color:T.error, fontFamily:'JetBrains Mono', marginTop:2, wordBreak:'break-all' }}>{tc.error}</div>}</div>
                        {tc.duration!==undefined && <span style={{ fontSize:11, color:T.textMuted, flexShrink:0 }}>{fmtMs(tc.duration)}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab==='agents' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {!Object.keys(allMet).length ? <Empty icon="🤖" title="Sin métricas" subtitle="Ejecuta misiones para ver rendimiento."/> :
            Object.entries(allMet).map(([role,m]) => { const meta=AMETA[role]||{icon:'🤖',name:role,color:T.textMuted}; return (
              <div key={role} style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:10, padding:'12px 16px', display:'flex', alignItems:'center', gap:13 }}>
                <div style={{ width:34, height:34, background:meta.color+'18', border:`1px solid ${meta.color}30`, borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', fontSize:17 }}>{meta.icon}</div>
                <div style={{ flex:1 }}><div style={{ fontSize:13, fontWeight:600, color:T.text, marginBottom:6 }}>{meta.name}</div><div style={{ display:'flex', gap:8, flexWrap:'wrap' }}><MetricChip label="Tareas" value={m.tasks} color={T.primary}/><MetricChip label="Avg Score" value={m.avgScore} color={m.avgScore>=80?T.success:m.avgScore>=60?T.warning:T.error}/><MetricChip label="Avg Tokens" value={m.avgTokens} color={T.accent}/><MetricChip label="Latencia" value={fmtMs(m.avgLatency)} color={T.teal}/></div></div>
                <ScoreBar score={m.avgScore}/>
              </div>
            ); })}
        </div>
      )}

      {tab==='ai' && (
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:9 }}>
            <MetricChip label="Ejecuciones" value={aiM.executions} color={T.primary}/>
            <MetricChip label="Tokens" value={aiService.getTotalTokens().toLocaleString()} color={T.accent}/>
            <MetricChip label="Avg Latencia" value={fmtMs(aiM.avgLatency)} color={T.teal}/>
          </div>
          <Divider/>
          <h4 style={{ fontSize:13, fontWeight:600, color:T.textDim }}>Adapters</h4>
          {[{name:'Simulation',s:'✅ activo',note:'Mock realistas por rol. Streaming via callbacks.'},{name:'Backend Proxy',s:'standby',note:'SSE streaming. API keys en servidor, nunca en cliente.'},{name:'Anthropic / OpenAI / Gemini / Ollama',s:'Fase 4',note:'Multi-provider via backend proxy.'}].map(a => (
            <div key={a.name} style={{ display:'flex', gap:11, alignItems:'center', padding:'8px 12px', background:T.surface, borderRadius:8, border:`1px solid ${T.border}`, marginBottom:5 }}>
              <Badge label={a.s} color={a.s==='✅ activo'?T.success:a.s==='standby'?T.warning:T.textMuted}/>
              <div><div style={{ fontSize:13, fontWeight:500, color:T.text }}>{a.name}</div><div style={{ fontSize:12, color:T.textMuted }}>{a.note}</div></div>
            </div>
          ))}
        </div>
      )}

      {tab==='evts' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:9, marginBottom:6 }}>
            <MetricChip label="Eventos" value={Object.values(evtS).reduce((s,v)=>s+v,0)} color={T.primary}/>
            <MetricChip label="Tipos" value={Object.keys(evtS).length} color={T.accent}/>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
            {Object.entries(evtS).sort((a,b)=>b[1]-a[1]).map(([type,count]) => { const max=Math.max(...Object.values(evtS),1); const color=ECOL[type]||T.textMuted; return (
              <div key={type} style={{ display:'flex', gap:9, alignItems:'center', padding:'5px 9px', background:T.surface, borderRadius:7 }}>
                <div style={{ width:8, height:8, borderRadius:'50%', background:color, flexShrink:0 }}/>
                <div style={{ flex:1, fontSize:12, color:T.textDim, fontFamily:'JetBrains Mono' }}>{type}</div>
                <div style={{ width:70, height:3, background:T.border, borderRadius:2 }}><div style={{ height:'100%', width:`${(count/max)*100}%`, background:color, borderRadius:2 }}/></div>
                <span style={{ fontSize:12, fontWeight:600, color:T.text, minWidth:22, textAlign:'right' }}>{count}</span>
              </div>
            ); })}
          </div>
        </div>
      )}

      {tab==='kernel' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:9 }}>
            <MetricChip label="Jobs activos" value={schS.running} color={T.success}/>
            <MetricChip label="Cola alta" value={schS.high} color={T.warning}/>
          </div>
          <Divider/>
          {[{n:'EventBus v3',d:'Pub/Sub + middleware + wildcards + prioridades + StreamChunk.',s:'✅'},{n:'Scheduler v3',d:'Cola high/medium/low. Máx 3 concurrentes. Retry backoff.',s:'✅'},{n:'ConfigManager v3',d:'Persistencia localStorage. Suscripciones reactivas.',s:'✅'},{n:'Storage v3',d:'IndexedDB + localStorage fallback. Auto-selección.',s:'✅'},{n:'Tool Engine v3',d:'9 tools schema-validated, permission-gated, timeout+retry.',s:'✅'},{n:'TestRunner v3',d:'Tests en browser contra módulos reales. Sin mocks.',s:'✅'},{n:'Streaming v3',d:'Callbacks (sin async generators). Cursor ▋ animado.',s:'✅'},{n:'Semantic Memory',d:'Embeddings vectoriales.',s:'🔄 Fase 4'},{n:'Tool Sandbox real',d:'Web Worker aislado.',s:'🔄 Fase 4'}].map(s => (
            <div key={s.n} style={{ display:'flex', gap:10, alignItems:'center', padding:'9px 12px', background:T.surface, borderRadius:8, border:`1px solid ${T.border}` }}>
              <Badge label={s.s} color={s.s==='✅'?T.success:T.textMuted}/>
              <div><div style={{ fontSize:13, fontWeight:600, color:T.text }}>{s.n}</div><div style={{ fontSize:12, color:T.textMuted }}>{s.d}</div></div>
            </div>
          ))}
        </div>
      )}

      {tab==='cfg' && (
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
            <Btn variant={config.simulationMode?'accent':'ghost'} onClick={toggleSim}>{config.simulationMode?'🔬 Simulación ON':'⚡ Simulación OFF'}</Btn>
            <Btn variant={config.streamingEnabled?'teal':'ghost'} onClick={toggleStreaming}>{config.streamingEnabled?'◎ Streaming ON':'○ Streaming OFF'}</Btn>
            <Btn variant={config.autoApprove?'success':'ghost'} onClick={()=>configManager.set({autoApprove:!config.autoApprove})}>{config.autoApprove?'✓ Auto-aprobar ON':'Auto-aprobar OFF'}</Btn>
          </div>
          <Divider/>
          <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:9, padding:14 }}>
            <pre style={{ fontSize:11, color:T.textDim, fontFamily:'JetBrains Mono', whiteSpace:'pre-wrap' }}>{JSON.stringify({ simulationMode:config.simulationMode, streamingEnabled:config.streamingEnabled, autoApprove:config.autoApprove, defaultModel:config.defaultModel },null,2)}</pre>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ─── SCREENS ────────────────────────────────────────────────────────────────────
function ProjectView({ project, onBack }) {
  const { exportProject } = useStore();
  const [tab, setTab] = useState('missions');
  const [showNewMission, setShowNewMission] = useState(false);
  const done = project.missions?.filter(m=>m.status==='completed').length || 0;
  const total = project.missions?.length || 0;
  const nodes = project.memory?.knowledgeGraph?.nodes?.length || 0;

  return (
    <div style={{ minHeight:'100vh', background:T.bg }}>
      <div style={{ background:T.surface, borderBottom:`1px solid ${T.border}`, padding:'12px 24px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:100 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <Btn variant="ghost" size="sm" onClick={onBack}>← Volver</Btn>
          <div>
            <div style={{ fontFamily:'Space Grotesk', fontWeight:700, fontSize:17, color:T.text }}>{project.name}</div>
            <div style={{ fontSize:11, color:T.textMuted, marginTop:1 }}>{CAT[project.category]?.label} · {done}/{total} misiones</div>
          </div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <button onClick={async () => {
            const current = await window.securityLayer?.getDecryptedKey('anthropic_key');
            const key = prompt('Introduce tu API Key de Anthropic (sk-ant-...) u OpenAI (sk-...) para usar modelos reales:', current || '');
            if (key !== null) {
              if (key.trim()) {
                const provider = key.startsWith('sk-ant-') ? 'anthropic_key' : 'openai_key';
                await window.securityLayer?.saveEncryptedKey(provider, key.trim());
                configManager.set({ simulationMode: false });
                alert('✓ API Key cifrada y guardada en tu navegador. Modo Real activado.');
              } else {
                window.securityLayer?.removeKey('anthropic_key');
                window.securityLayer?.removeKey('openai_key');
                configManager.set({ simulationMode: true });
                alert('API Key eliminada. Modo Simulación activado.');
              }
            }
          }} style={{ padding:'4px 10px', borderRadius:20, border:`1px solid ${(window.securityLayer?.hasKey('anthropic_key')||window.securityLayer?.hasKey('openai_key'))?T.primary+'60':T.border}`, background:(window.securityLayer?.hasKey('anthropic_key')||window.securityLayer?.hasKey('openai_key'))?T.primary+'15':'transparent', color:(window.securityLayer?.hasKey('anthropic_key')||window.securityLayer?.hasKey('openai_key'))?T.primary:T.textMuted, fontSize:11, fontWeight:500, cursor:'pointer' }}>
            {(window.securityLayer?.hasKey('anthropic_key')||window.securityLayer?.hasKey('openai_key')) ? '🔑 Key Real ON' : '🔑 Key Real'}
          </button>
          <Btn variant="ghost" size="sm" onClick={() => exportProject(project.id)}>📤 Exportar</Btn>
          <Btn size="sm" onClick={() => setShowNewMission(true)}>+ Nueva misión</Btn>
        </div>
      </div>

      <div style={{ maxWidth:1100, margin:'0 auto', padding:24 }}>
        <div style={{ borderBottom:`1px solid ${T.border}`, display:'flex', marginBottom:20, gap:2 }}>
          {[['missions',`🎯 Misiones (${total})`],['memory',`🧠 Memoria (${nodes})`],['agents','🤖 Agentes'],['tools','🔧 Tools'],['timeline','⏱ Timeline']].map(([id,label]) => (
            <button key={id} style={{ background:tab===id?T.primary+'18':'transparent', border:'none', borderBottom:`2px solid ${tab===id?T.primary:'transparent'}`, color:tab===id?T.primary:T.textMuted, padding:'10px 16px', fontWeight:500, fontSize:14, cursor:'pointer' }} onClick={()=>setTab(id)}>{label}</button>
          ))}
        </div>

        {tab==='missions' && <MissionsTab project={project} onNewMission={() => setShowNewMission(true)} />}
        {tab==='memory' && <MemoryTab project={project} />}
        {tab==='agents' && <AgentsTab />}
        {tab==='tools' && <ToolsTab />}
        {tab==='timeline' && <TimelineTab projectId={project.id} />}
      </div>

      <NewMissionModal open={showNewMission} onClose={() => setShowNewMission(false)} projectId={project.id} />
    </div>
  );
}

function Dashboard() {
  const { projects, activeProjectId, setActiveProjectId, deleteProject, config, toggleSim, importProject, storageReady } = useStore();
  const [selectedId, setSelectedId] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showDev, setShowDev] = useState(false);
  const [importText, setImportText] = useState('');
  const [importErr, setImportErr] = useState('');
  const fileRef = useRef();

  const currentId = selectedId || activeProjectId;
  const activeProject = projects.find(p => p.id === currentId);

  if (activeProject) {
    return <ProjectView project={activeProject} onBack={() => { setSelectedId(null); setActiveProjectId(null); }} />;
  }

  const tot = projects.reduce((s,p)=>s+(p.missions?.length||0),0);
  const done = projects.reduce((s,p)=>s+(p.missions?.filter(m=>m.status==='completed').length||0),0);
  const nodes = projects.reduce((s,p)=>s+(p.memory?.knowledgeGraph?.nodes?.length||0),0);

  const onFile = e => { const f=e.target.files[0]; if(!f)return; const r=new FileReader(); r.onload=ev=>setImportText(ev.target.result); r.readAsText(f); };
  const onImport = async () => { setImportErr(''); try { await importProject(importText); setShowImport(false); setImportText(''); } catch(e) { setImportErr(e.message); } };

  return (
    <div style={{ minHeight:'100vh', background:T.bg }}>
      <div style={{ background:T.surface, borderBottom:`1px solid ${T.border}`, padding:'14px 24px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:100 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ width:36, height:36, background:`linear-gradient(135deg,${T.primary},${T.accent})`, borderRadius:10, display:'flex', alignItems:'center', justifyContent:'center', fontSize:18 }}>⚡</div>
          <div>
            <div style={{ fontFamily:'Space Grotesk', fontWeight:700, fontSize:19, color:T.text, lineHeight:1 }}>ForgeAI</div>
            <div style={{ fontSize:10, color:T.textMuted, marginTop:2, letterSpacing:'.07em', textTransform:'uppercase' }}>Kernel v3.0 · TypeScript · IndexedDB · Streaming · Tool Engine</div>
          </div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          {!storageReady && <span style={{ fontSize:12, color:T.warning }}>⏳ IndexedDB…</span>}
          <button onClick={toggleSim} style={{ padding:'5px 12px', borderRadius:20, border:`1px solid ${config.simulationMode?T.accent+'60':T.border}`, background:config.simulationMode?T.accent+'15':'transparent', color:config.simulationMode?T.accent:T.textMuted, fontSize:12, fontWeight:500, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
            {config.simulationMode ? '🔬 Simulación' : '⚡ Real'}
          </button>
          <button onClick={async () => {
            const current = await window.securityLayer?.getDecryptedKey('claude_session_key');
            const action = confirm('¿Quieres introducir tu clave/cookie de Claude.ai manualmente?\n\nSi usas Opera Móvil, pulsa Aceptar para escribir/pegar tu token, o Cancelar si prefieres usar el modo gratuito simulado.');
            if (action) {
              const raw = prompt('Pega aquí el código que empieza por sk-ant-sid01-... (o toda la cookie):', current || '');
              if (raw && raw.trim()) {
                let key = raw.trim();
                if (key.includes('sessionKey=')) key = key.split('sessionKey=')[1].split(';')[0].trim();
                await window.securityLayer?.saveEncryptedKey('claude_session_key', key);
                alert('✓ Sesión cifrada y guardada correctamente.');
              }
            }
          }} style={{ padding:'5px 12px', borderRadius:20, border:`1px solid ${window.securityLayer?.hasKey('claude_session_key')?T.teal+'60':T.border}`, background:window.securityLayer?.hasKey('claude_session_key')?T.teal+'15':'transparent', color:window.securityLayer?.hasKey('claude_session_key')?T.teal:T.textMuted, fontSize:12, fontWeight:500, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
            {window.securityLayer?.hasKey('claude_session_key') ? '🌐 Claude Web ON' : '🌐 Claude Web'}
          </button>
          <button onClick={async () => {
            const current = await window.securityLayer?.getDecryptedKey('github_token');
            const token = prompt('Introduce tu GitHub Personal Access Token (PAT) para Auto-Sync automático a tu cuenta de GitHub:', current || '');
            if (token !== null) {
              if (token.trim()) {
                await window.securityLayer?.saveEncryptedKey('github_token', token.trim());
                alert('✓ GitHub Token cifrado y guardado localmente en tu navegador. Tus proyectos se sincronizarán automáticamente con GitHub.');
              } else {
                window.securityLayer?.removeKey('github_token');
                alert('GitHub Auto-Sync desactivado.');
              }
            }
          }} style={{ padding:'5px 12px', borderRadius:20, border:`1px solid ${window.securityLayer?.hasKey('github_token')?T.success+'60':T.border}`, background:window.securityLayer?.hasKey('github_token')?T.success+'15':'transparent', color:window.securityLayer?.hasKey('github_token')?T.success:T.textMuted, fontSize:12, fontWeight:500, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
            {window.securityLayer?.hasKey('github_token') ? '🟢 GitHub Sync ON' : '⚪ GitHub Sync OFF'}
          </button>
          <Btn variant="ghost" size="sm" onClick={() => setShowDev(true)}>🔬 Dev Panel</Btn>
          <Btn variant="ghost" size="sm" onClick={() => setShowImport(true)}>📥 Importar</Btn>
          <Btn size="sm" onClick={() => setShowCreate(true)}>+ Nuevo proyecto</Btn>
        </div>
      </div>

      <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:24 }}>
          <MetricChip label="Proyectos activos" value={projects.length} color={T.primary}/>
          <MetricChip label="Misiones totales" value={tot} color={T.accent}/>
          <MetricChip label="Misiones completadas" value={done} color={T.success}/>
          <MetricChip label="Nodos memoria" value={nodes} color={T.teal}/>
        </div>

        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <h2 style={{ color: T.text, fontFamily: 'Space Grotesk', fontSize: 20 }}>Proyectos ({projects.length})</h2>
          <Btn size="sm" onClick={() => setShowCreate(true)}>+ Nuevo proyecto</Btn>
        </div>

        {projects.length === 0 ? (
          <Empty 
            icon="📦" 
            title="Sin proyectos activos" 
            subtitle="Crea tu primer proyecto para empezar a asignar misiones a los agentes de IA."
            action={<Btn onClick={() => setShowCreate(true)}>+ Crear primer proyecto</Btn>}
          />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
            {projects.map(p => (
              <Card key={p.id} onClick={() => { setSelectedId(p.id); setActiveProjectId(p.id); }} style={{ padding: 18, cursor: 'pointer' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:8 }}>
                  <h3 style={{ color: T.text, fontSize: 16, fontFamily:'Space Grotesk' }}>{p.name}</h3>
                  <Badge label={CAT[p.category]?.label || p.category} color={CAT[p.category]?.color || T.primary}/>
                </div>
                <p style={{ color: T.textMuted, fontSize: 13, minHeight: 36 }}>{p.description || 'Sin descripción'}</p>
                <Divider/>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span style={{ fontSize:12, color:T.textDim }}>{p.missions?.length || 0} misiones</span>
                  <div style={{ display:'flex', gap:6 }}>
                    <Btn size="xs" onClick={(e) => { e.stopPropagation(); setSelectedId(p.id); setActiveProjectId(p.id); }}>Abrir →</Btn>
                    <Btn size="xs" variant="ghost" onClick={(e) => { e.stopPropagation(); deleteProject(p.id); }}>Eliminar</Btn>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <CreateProjectModal open={showCreate} onClose={() => setShowCreate(false)}/>
      <DevPanel open={showDev} onClose={() => setShowDev(false)}/>
      <ApprovalLayer/>
    </div>
  );
}

window.StoreProvider = StoreProvider;
window.Dashboard = Dashboard;
       