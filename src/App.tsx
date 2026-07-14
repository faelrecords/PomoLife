import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import {
  ArrowDown,
  ArrowRight,
  Check,
  Clipboard,
  Copy,
  Cpu,
  Download,
  ExternalLink,
  History,
  Orbit,
  Play,
  RotateCcw,
  Save,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  PROMPT_DEFINITIONS,
  createInitialValues,
  getPromptDefinition,
  hasValidationErrors,
  type FormValues,
  type PlanMode,
  type PlanRecord,
  type PromptDefinition,
  type ValidationErrors,
} from "./domain";
import {
  WEBLLM_ESTIMATED_DOWNLOAD_MB,
  WEBLLM_ESTIMATED_VRAM_MB,
  WEBLLM_MODEL_ID,
  createBasicPlannerEngine,
  createWebLLMPlannerEngine,
  type PlannerEngine,
  type PlannerEngineSnapshot,
} from "./engine";
import {
  clearAllLocalData,
  clearHistory,
  clearFocusSession,
  getDraft,
  getPlans,
  getPreferences,
  removePlan,
  saveDraft,
  saveFocusSession,
  savePlanWithStatus,
  updatePreferences,
  loadFocusSession,
  type UserPreferences,
} from "./lib/storage";
import { createFocusSession, type FocusSession } from "./lib/focusTimer";
import { CosmicBackdrop } from "./components/CosmicBackdrop";
import { FocusSessionDock } from "./components/FocusSessionDock";
import { FormField } from "./components/FormField";
import { MarkdownResult } from "./components/MarkdownResult";
import { Modal } from "./components/Modal";
import { PromptIcon } from "./components/PromptIcon";

const CARD_META: Record<string, string> = {
  paralysis: "Primeiro passo · < 1 min",
  dopamine: "Movimento · foco · pausa",
  focus: "Sessão guiada · 30 min",
  transition: "Ritual rápido · 3 min",
  game: "Missão · checkpoints · prêmio",
  time: "Estimativa · margem · realidade",
  "brain-dump": "Agora · depois · descartar",
};

const INITIAL_ENGINE_SNAPSHOT: PlannerEngineSnapshot = {
  status: "idle",
  progress: null,
  error: null,
};

function valuesFor(definition: PromptDefinition): FormValues {
  const initial = createInitialValues(definition);
  const draft = getDraft(definition.id);
  if (!draft) return initial;
  const draftValues = Object.fromEntries(
    Object.entries(draft.values).map(([key, value]) => [key, String(value)]),
  );
  return { ...initial, ...draftValues };
}

function definitionFromHash(): PromptDefinition | null {
  if (typeof window === "undefined") return null;
  return getPromptDefinition(window.location.hash.replace(/^#/, "")) ?? null;
}

function formatPlanDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function engineStatusLabel(snapshot: PlannerEngineSnapshot, preferences: UserPreferences) {
  if (snapshot.status === "unsupported") return "Modo básico";
  if (snapshot.status === "downloading") return "Baixando IA";
  if (snapshot.status === "loading") return "Preparando IA";
  if (snapshot.status === "ready") return "IA local pronta";
  if (snapshot.status === "generating") return "Gerando localmente";
  if (snapshot.status === "error") return "IA indisponível";
  if (preferences.preferredMode === "basic") return "Modo básico";
  return "IA sob demanda";
}

export default function App() {
  const aiEngine = useMemo(() => createWebLLMPlannerEngine(), []);
  const basicEngine = useMemo(() => createBasicPlannerEngine(), []);
  const aiSnapshot = useSyncExternalStore(
    aiEngine.subscribe,
    aiEngine.getSnapshot,
    () => INITIAL_ENGINE_SNAPSHOT,
  );

  const initialDefinition = useMemo(definitionFromHash, []);
  const [activeDefinition, setActiveDefinition] = useState<PromptDefinition | null>(initialDefinition);
  const [values, setValues] = useState<FormValues>(() =>
    initialDefinition ? valuesFor(initialDefinition) : {},
  );
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({});
  const [output, setOutput] = useState("");
  const [outputMode, setOutputMode] = useState<PlanMode | null>(null);
  const [generationError, setGenerationError] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [actionStarted, setActionStarted] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [plans, setPlans] = useState<PlanRecord[]>(() => getPlans());
  const [savedPlanId, setSavedPlanId] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<UserPreferences>(() => getPreferences());
  const [modelCached, setModelCached] = useState<boolean | "error" | null>(null);
  const [cacheBusy, setCacheBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [focusSession, setFocusSession] = useState<FocusSession | null>(() => loadFocusSession());
  const [now, setNow] = useState(Date.now());
  const abortRef = useRef<AbortController | null>(null);

  const showToast = useCallback((message: string) => setToast(message), []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const onHashChange = () => {
      const definition = definitionFromHash();
      if (definition) {
        setActiveDefinition(definition);
        setValues(valuesFor(definition));
        setValidationErrors({});
        setOutput("");
        setOutputMode(null);
        setSavedPlanId(null);
      } else {
        const engineStatus = aiEngine.getSnapshot().status;
        abortRef.current?.abort();
        void aiEngine.cancel();
        void basicEngine.cancel();
        if (engineStatus === "downloading" || engineStatus === "loading") {
          const next = updatePreferences({ preferredMode: "ask" });
          setPreferences(next);
        }
        setActiveDefinition(null);
        setConsentOpen(false);
        setIsGenerating(false);
      }
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [aiEngine, basicEngine]);

  useEffect(() => {
    if (!activeDefinition) return;
    const timer = window.setTimeout(() => saveDraft(activeDefinition.id, values), 280);
    return () => window.clearTimeout(timer);
  }, [activeDefinition, values]);

  useEffect(() => {
    if (!focusSession) return;
    const tick = () => setNow(Date.now());
    tick();
    const interval = window.setInterval(tick, 1_000);
    const onVisibility = () => tick();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [focusSession]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      void aiEngine.dispose();
      void basicEngine.dispose();
    };
  }, [aiEngine, basicEngine]);

  useEffect(() => {
    if (!settingsOpen) return;
    setModelCached(null);
    void aiEngine
      .hasModelInCache()
      .then(setModelCached)
      .catch(() => setModelCached("error"));
  }, [aiEngine, settingsOpen]);

  const openPlanner = useCallback((definition: PromptDefinition) => {
    setActiveDefinition(definition);
    setValues(valuesFor(definition));
    setValidationErrors({});
    setOutput("");
    setOutputMode(null);
    setGenerationError("");
    setActionStarted(false);
    setSavedPlanId(null);
    window.history.pushState(null, "", `#${definition.slug}`);
  }, []);

  const closePlanner = useCallback(() => {
    const engineStatus = aiEngine.getSnapshot().status;
    abortRef.current?.abort();
    void aiEngine.cancel();
    void basicEngine.cancel();
    if (engineStatus === "downloading" || engineStatus === "loading") {
      const next = updatePreferences({ preferredMode: "ask" });
      setPreferences(next);
    }
    setActiveDefinition(null);
    setConsentOpen(false);
    setGenerationError("");
    window.history.pushState(null, "", `${window.location.pathname}${window.location.search}`);
  }, [aiEngine, basicEngine]);

  const updateValue = (name: string, value: string) => {
    setValues((current) => ({ ...current, [name]: value }));
    setValidationErrors((current) => {
      if (!current[name]) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  };

  const runGeneration = useCallback(
    async (engine: PlannerEngine) => {
      if (!activeDefinition) return;
      setIsGenerating(true);
      setGenerationError("");
      setOutput("");
      setOutputMode(null);
      setActionStarted(false);
      setSavedPlanId(null);
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        await engine.initialize();
        if (engine.mode === "ai") setConsentOpen(false);
        const result = await engine.generate(activeDefinition, values, {
          signal: controller.signal,
          onToken: (_delta, accumulated) => setOutput(accumulated),
        });
        if (result.cancelled) return;
        setOutput(result.text);
        setOutputMode(result.mode);
        const saveResult = savePlanWithStatus({
          promptId: activeDefinition.id,
          promptTitle: activeDefinition.title,
          values,
          result: result.text,
          mode: result.mode,
        });
        if (saveResult.saved) {
          setSavedPlanId(saveResult.record.id);
          setPlans(getPlans());
          showToast(`Plano salvo neste navegador · ${saveResult.record.mode === "ai" ? "IA local" : "modo básico"}`);
        } else {
          setSavedPlanId(null);
          showToast("Plano pronto, mas o navegador não permitiu salvá-lo.");
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : "Não foi possível gerar o plano.";
        setGenerationError(message);
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setIsGenerating(false);
      }
    },
    [activeDefinition, showToast, values],
  );

  const requestGeneration = (event?: FormEvent) => {
    event?.preventDefault();
    if (!activeDefinition) return;
    const errors = activeDefinition.validate(values);
    setValidationErrors(errors);
    if (hasValidationErrors(errors)) {
      const firstField = activeDefinition.fields.find((field) => errors[field.name]);
      if (firstField) document.getElementById(`field-${firstField.name}`)?.focus();
      return;
    }

    if (preferences.preferredMode === "basic" || aiSnapshot.status === "unsupported") {
      void runGeneration(basicEngine);
      return;
    }
    if (preferences.preferredMode === "ai") {
      void runGeneration(aiEngine);
      return;
    }
    setConsentOpen(true);
  };

  const activateAI = () => {
    const next = updatePreferences({ preferredMode: "ai" });
    setPreferences(next);
    void runGeneration(aiEngine);
  };

  const stopAISetup = async () => {
    const snapshot = aiEngine.getSnapshot();
    abortRef.current?.abort();
    await aiEngine.cancel();
    if (snapshot.status === "downloading" && !snapshot.progress?.fromCache) {
      try {
        await aiEngine.clearModelCache();
      } catch {
        // A limpeza também permanece disponível nas configurações.
      }
    }
  };

  const selectBasicMode = async () => {
    await stopAISetup();
    const next = updatePreferences({ preferredMode: "basic" });
    setPreferences(next);
    setConsentOpen(false);
    await runGeneration(basicEngine);
  };

  const cancelAISetup = async () => {
    await stopAISetup();
    const next = updatePreferences({ preferredMode: "ask" });
    setPreferences(next);
    setConsentOpen(false);
    setIsGenerating(false);
  };

  const cancelGeneration = () => {
    abortRef.current?.abort();
    void aiEngine.cancel();
    void basicEngine.cancel();
    setIsGenerating(false);
    setOutput("");
    setOutputMode(null);
    setSavedPlanId(null);
    setActionStarted(false);
    showToast("Geração cancelada.");
  };

  const copyResult = async () => {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
      showToast("Plano copiado.");
    } catch {
      showToast("Não foi possível copiar automaticamente.");
    }
  };

  const saveCurrentPlan = () => {
    if (!activeDefinition || !output || !outputMode) return;
    const saveResult = savePlanWithStatus({
      id: savedPlanId ?? undefined,
      promptId: activeDefinition.id,
      promptTitle: activeDefinition.title,
      values,
      result: output,
      mode: outputMode,
    });
    if (!saveResult.saved) {
      showToast("O navegador não permitiu salvar este plano.");
      return;
    }
    setSavedPlanId(saveResult.record.id);
    setPlans(getPlans());
    showToast("Plano salvo neste navegador.");
  };

  const startAction = () => {
    if (!activeDefinition) return;
    setActionStarted(true);
    if (activeDefinition.id === "focus") {
      const session = createFocusSession({
        task: values.task ?? "Sessão de foco",
        desiredOutcome: values.outcome,
        distraction: values.distraction,
      });
      setFocusSession(session);
      setNow(Date.now());
      saveFocusSession(session);
      closePlanner();
      showToast("Bloco de 30 minutos iniciado.");
      return;
    }
    showToast("Em andamento. Fique só no primeiro movimento.");
  };

  const openSavedPlan = (plan: PlanRecord) => {
    const definition = getPromptDefinition(plan.promptId);
    if (!definition) return;
    setHistoryOpen(false);
    setActiveDefinition(definition);
    setValues({ ...createInitialValues(definition), ...plan.values });
    setOutput(plan.result);
    setOutputMode(plan.mode);
    setValidationErrors({});
    setGenerationError("");
    setActionStarted(false);
    setSavedPlanId(plan.id);
    window.history.pushState(null, "", `#${definition.slug}`);
  };

  const deletePlan = (planId: string) => {
    removePlan(planId);
    setPlans(getPlans());
  };

  const updatePreference = (updates: Partial<UserPreferences>) => {
    const next = updatePreferences(updates);
    setPreferences(next);
  };

  const toggleNotifications = async (enabled: boolean) => {
    if (!enabled) {
      updatePreference({ notificationsEnabled: false });
      return;
    }
    if (!("Notification" in window)) {
      showToast("Este navegador não oferece notificações.");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission === "granted") updatePreference({ notificationsEnabled: true });
    else showToast("Permissão de notificações não concedida.");
  };

  const removeModel = async () => {
    setCacheBusy(true);
    try {
      await aiEngine.clearModelCache();
      setModelCached(false);
      const next = updatePreferences({ preferredMode: "ask" });
      setPreferences(next);
      showToast("Arquivos da IA removidos do dispositivo.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Não foi possível remover o modelo.");
    } finally {
      setCacheBusy(false);
    }
  };

  const clearSavedData = () => {
    if (!window.confirm("Apagar rascunhos, histórico, preferências e sessão de foco deste navegador?")) return;
    clearAllLocalData();
    setPlans([]);
    setPreferences(getPreferences());
    setFocusSession(null);
    setSettingsOpen(false);
    showToast("Dados locais apagados.");
  };

  const busy = isGenerating || aiSnapshot.status === "downloading" || aiSnapshot.status === "loading";
  const statusLabel = engineStatusLabel(aiSnapshot, preferences);

  return (
    <div className={`app-shell ${busy ? "is-busy" : ""}`}>
      <a className="skip-link" href="#ferramentas">Pular para as ferramentas</a>
      <CosmicBackdrop paused={busy} />

      <header className="site-header">
        <a className="brand-lockup" href={import.meta.env.BASE_URL} aria-label="PomoLife, início">
          <span className="brand-mark"><Orbit size={23} strokeWidth={1.5} /></span>
          <span className="brand-copy">
            <strong>PomoLife</strong>
            <small>Vibecodex</small>
          </span>
        </a>
        <div className="header-actions">
          <button className={`engine-status status-${aiSnapshot.status}`} type="button" aria-label={statusLabel} onClick={() => setSettingsOpen(true)}>
            <span className="signal-dot" />
            <span>{statusLabel}</span>
          </button>
          <button className="icon-button" type="button" aria-label="Abrir histórico" title="Histórico" onClick={() => { setPlans(getPlans()); setHistoryOpen(true); }}>
            <History size={19} />
            {plans.length > 0 && <span className="button-count">{plans.length}</span>}
          </button>
          <button className="icon-button" type="button" aria-label="Abrir configurações" title="Configurações" onClick={() => setSettingsOpen(true)}>
            <Settings size={19} />
          </button>
        </div>
      </header>

      <main>
        <section className="hero-section" aria-labelledby="hero-title">
          <div className="content-frame hero-grid">
            <div className="hero-copy">
              <p className="eyebrow"><span className="signal-dot" /> Planejamento local / zero API</p>
              <h1 id="hero-title">
                <span>Clareza para começar.</span>
                <span className="accent-word">Foco para continuar.</span>
              </h1>
              <p className="hero-description">
                Sete ferramentas para transformar sobrecarga em um próximo passo possível — com IA no seu navegador ou um modo básico que funciona em qualquer dispositivo.
              </p>
              <div className="hero-actions">
                <a className="button button-primary" href="#ferramentas">Escolher uma ferramenta <ArrowDown size={17} /></a>
                <button className="button button-secondary" type="button" onClick={() => setSettingsOpen(true)}>Como funciona</button>
              </div>
              <div className="privacy-note">
                <ShieldCheck size={18} />
                <span><strong>Seus textos não saem do dispositivo.</strong> A IA só é baixada quando você escolher ativá-la.</span>
              </div>
            </div>
            <div className="hero-telemetry" aria-hidden="true">
              <span>PL / 001</span>
              <span>7 ROTAS DE FOCO</span>
              <span className="telemetry-live">LOCAL</span>
            </div>
          </div>
        </section>

        <section className="tools-section" id="ferramentas" aria-labelledby="tools-title">
          <div className="content-frame">
            <div className="section-heading">
              <div>
                <p className="eyebrow"><span className="signal-dot" /> Escolha o que você precisa agora</p>
                <h2 id="tools-title">Menos fricção.<br />Um passo de cada vez.</h2>
              </div>
              <p>Não existe ordem certa. Abra o card que mais se parece com o momento atual e preencha somente o necessário.</p>
            </div>

            <div className="tools-grid">
              {PROMPT_DEFINITIONS.map((definition, index) => (
                <button
                  key={definition.id}
                  type="button"
                  className={`tool-card ${index === PROMPT_DEFINITIONS.length - 1 ? "is-wide" : ""}`}
                  onClick={() => openPlanner(definition)}
                >
                  <span className="card-topline">
                    <span className="tool-number">{definition.number}</span>
                    <span className="tool-icon"><PromptIcon id={definition.id} /></span>
                  </span>
                  <span className="tool-card-copy">
                    <strong>{definition.title}</strong>
                    <span>{definition.description}</span>
                  </span>
                  <span className="card-footerline">
                    <small>{CARD_META[definition.id]}</small>
                    <ArrowRight size={19} />
                  </span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="local-section" aria-labelledby="local-title">
          <div className="content-frame local-grid">
            <div className="local-orbit" aria-hidden="true"><Cpu size={31} /><span /></div>
            <div>
              <p className="eyebrow"><span className="signal-dot" /> Privado por arquitetura</p>
              <h2 id="local-title">A inteligência roda onde o trabalho acontece: aqui.</h2>
            </div>
            <div className="local-copy">
              <p>O PomoLife não envia suas tarefas para um servidor. Se você ativar a IA, o navegador baixa um modelo compacto uma única vez e guarda os arquivos localmente.</p>
              <ul>
                <li><Check size={16} /> Sem conta ou chave de API</li>
                <li><Check size={16} /> Modo básico sempre disponível</li>
                <li><Check size={16} /> Cache removível nas configurações</li>
              </ul>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="content-frame footer-content">
          <p>© {new Date().getFullYear()} PomoLife · Fael Records</p>
          <p>Ferramenta de apoio à organização; não substitui acompanhamento profissional.</p>
          <a href="https://github.com/faelrecords/PomoLife" target="_blank" rel="noreferrer">Ver repositório <ExternalLink size={14} /></a>
        </div>
      </footer>

      <Modal open={activeDefinition !== null} labelledBy="planner-title" onClose={closePlanner} closeOnBackdrop={!busy} inactive={consentOpen} className="planner-modal">
        {activeDefinition && (
          <>
            <div className="modal-header planner-header">
              <div className="planner-title-lockup">
                <span className="tool-icon"><PromptIcon id={activeDefinition.id} /></span>
                <div>
                  <p className="eyebrow">{activeDefinition.number} / ferramenta</p>
                  <h2 id="planner-title">{activeDefinition.title}</h2>
                </div>
              </div>
              <button className="icon-button" type="button" aria-label="Fechar ferramenta" onClick={closePlanner} disabled={busy}>
                <X size={20} />
              </button>
            </div>

            <div className="planner-grid">
              <form className="planner-form" onSubmit={requestGeneration} noValidate>
                <div className="panel-intro">
                  <span>01</span>
                  <div>
                    <strong>Conte o contexto</strong>
                    <p>Preencha do seu jeito. Não precisa organizar ou escrever bonito.</p>
                  </div>
                </div>
                <div className="fields-stack">
                  {activeDefinition.fields.map((field) => (
                    <FormField key={field.name} field={field} values={values} errors={validationErrors} onChange={updateValue} />
                  ))}
                </div>
                <div className="form-actions">
                  <button className="button button-primary" type="submit" disabled={busy}>
                    <Sparkles size={17} />
                    {activeDefinition.id === "focus" ? "Preparar sessão" : output ? "Gerar novamente" : "Gerar plano"}
                  </button>
                  <small>{preferences.preferredMode === "basic" ? "Modo básico local" : "Processamento no navegador"}</small>
                </div>
              </form>

              <section className="result-panel" aria-labelledby="result-title" aria-busy={isGenerating}>
                <span className="sr-only" role="status" aria-live="polite">
                  {isGenerating ? "Gerando o plano localmente." : output ? "Plano concluído." : ""}
                </span>
                <div className="panel-intro result-intro">
                  <span>02</span>
                  <div>
                    <strong id="result-title">Seu plano</strong>
                    <p>Curto, concreto e pronto para usar.</p>
                  </div>
                  {outputMode && <span className={`mode-chip mode-${outputMode}`}>{outputMode === "ai" ? "IA local" : "Plano básico"}</span>}
                </div>

                <div className={`result-surface ${isGenerating ? "is-streaming" : ""}`}>
                  {generationError ? (
                    <div className="result-error" role="alert">
                      <strong>Algo interrompeu a geração.</strong>
                      <p>{generationError}</p>
                      <button className="button button-secondary button-compact" type="button" onClick={() => void runGeneration(basicEngine)}>Usar modo básico</button>
                    </div>
                  ) : output ? (
                    <>
                      <MarkdownResult>{output}</MarkdownResult>
                      {actionStarted && (
                        <div className="action-started"><span className="signal-dot" /> Em andamento. Fique só no próximo movimento.</div>
                      )}
                    </>
                  ) : isGenerating ? (
                    <div className="streaming-placeholder">
                      <span className="streaming-orbit"><Sparkles size={22} /></span>
                      <strong>Organizando o próximo passo…</strong>
                      <p>O texto aparece aqui enquanto é criado.</p>
                    </div>
                  ) : (
                    <div className="empty-result">
                      <Clipboard size={30} />
                      <strong>Seu plano vai aparecer aqui</strong>
                      <p>Preencha os campos e use o botão ao lado.</p>
                    </div>
                  )}
                </div>

                {(output || isGenerating) && (
                  <div className="result-actions">
                    {isGenerating ? (
                      <button className="button button-secondary" type="button" onClick={cancelGeneration}><X size={16} /> Cancelar</button>
                    ) : (
                      <>
                        <button className="button button-primary" type="button" onClick={startAction}><Play size={16} /> {activeDefinition.id === "focus" ? "Iniciar 30 min" : "Começar agora"}</button>
                        <button className="button button-secondary" type="button" onClick={copyResult}><Copy size={16} /> Copiar</button>
                        <button className="button button-secondary" type="button" onClick={saveCurrentPlan} disabled={savedPlanId !== null}><Save size={16} /> {savedPlanId ? "Salvo" : "Salvar"}</button>
                        <button className="icon-button" type="button" aria-label="Gerar novamente" title="Gerar novamente" onClick={() => requestGeneration()}><RotateCcw size={17} /></button>
                      </>
                    )}
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </Modal>

      <Modal open={consentOpen} labelledBy="consent-title" onClose={() => void cancelAISetup()} className="compact-modal consent-modal">
        <div className="modal-header">
          <div className="consent-icon"><Download size={23} /></div>
          <button className="icon-button" type="button" aria-label={busy ? "Cancelar preparação da IA" : "Fechar"} onClick={() => void cancelAISetup()}><X size={19} /></button>
        </div>
        <div className="consent-copy">
          <p className="eyebrow"><span className="signal-dot" /> Primeira ativação</p>
          <h2 id="consent-title">Ativar a IA local?</h2>
          <p>O modelo será baixado e executado neste dispositivo. Seus campos não serão enviados junto com o download.</p>
          <dl className="model-facts">
            <div><dt>Download</dt><dd>≈ {WEBLLM_ESTIMATED_DOWNLOAD_MB} MB</dd></div>
            <div><dt>Memória gráfica</dt><dd>≈ {WEBLLM_ESTIMATED_VRAM_MB} MB</dd></div>
            <div><dt>Modelo</dt><dd>Qwen 2.5 · 0.5B</dd></div>
          </dl>

          {(aiSnapshot.status === "downloading" || aiSnapshot.status === "loading") && aiSnapshot.progress && (
            <div className="download-progress" aria-live="polite">
              <div className="progress-label"><span>{aiSnapshot.progress.fromCache ? "Preparando arquivos salvos" : "Baixando modelo"}</span><strong>{Math.round(aiSnapshot.progress.value * 100)}%</strong></div>
              <div
                className="progress-track"
                role="progressbar"
                aria-label={aiSnapshot.progress.fromCache ? "Preparando modelo salvo" : "Baixando modelo local"}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(aiSnapshot.progress.value * 100)}
              ><span style={{ width: `${aiSnapshot.progress.value * 100}%` }} /></div>
              <small>{aiSnapshot.progress.message}</small>
            </div>
          )}
          {aiSnapshot.error && <p className="consent-error" role="alert">{aiSnapshot.error.message}</p>}

          <div className="consent-actions">
            <button className="button button-primary" type="button" onClick={activateAI} disabled={busy}><Download size={17} /> {busy ? "Preparando…" : "Ativar IA local"}</button>
            <button className="button button-secondary" type="button" onClick={() => void selectBasicMode()}>Usar modo básico</button>
          </div>
          <small className="consent-footnote">Você pode remover o modelo e trocar o modo a qualquer momento.</small>
        </div>
      </Modal>

      <Modal open={historyOpen} labelledBy="history-title" onClose={() => setHistoryOpen(false)} className="side-modal">
        <div className="modal-header">
          <div>
            <p className="eyebrow"><History size={15} /> Somente neste navegador</p>
            <h2 id="history-title">Histórico</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Fechar histórico" onClick={() => setHistoryOpen(false)}><X size={19} /></button>
        </div>
        <div className="history-list">
          {plans.length === 0 ? (
            <div className="empty-list"><History size={28} /><strong>Nenhum plano salvo ainda</strong><p>Os planos concluídos aparecem aqui automaticamente.</p></div>
          ) : plans.map((plan) => (
            <article className="history-item" key={plan.id}>
              <button className="history-open" type="button" onClick={() => openSavedPlan(plan)}>
                <span className="history-meta"><span className={`mode-dot mode-${plan.mode}`} /> {plan.mode === "ai" ? "IA local" : "Básico"} · {formatPlanDate(plan.createdAt)}</span>
                <strong>{plan.promptTitle}</strong>
                <p>{plan.result.replace(/[#*_`>-]/g, "").slice(0, 135)}</p>
              </button>
              <button className="icon-button icon-button-small" type="button" aria-label={`Excluir ${plan.promptTitle}`} onClick={() => deletePlan(plan.id)}><Trash2 size={15} /></button>
            </article>
          ))}
        </div>
        {plans.length > 0 && (
          <button className="button button-danger" type="button" onClick={() => {
            if (window.confirm("Apagar todo o histórico salvo neste navegador?")) {
              clearHistory();
              setPlans([]);
            }
          }}><Trash2 size={16} /> Apagar histórico</button>
        )}
      </Modal>

      <Modal open={settingsOpen} labelledBy="settings-title" onClose={() => setSettingsOpen(false)} className="side-modal settings-modal">
        <div className="modal-header">
          <div>
            <p className="eyebrow"><Settings size={15} /> Controle local</p>
            <h2 id="settings-title">Configurações</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Fechar configurações" onClick={() => setSettingsOpen(false)}><X size={19} /></button>
        </div>

        <section className="settings-section">
          <div className="settings-heading"><strong>Modo de planejamento</strong><p>Escolha o que acontece ao gerar um plano.</p></div>
          <div className="segmented-control" role="radiogroup" aria-label="Modo de planejamento preferido">
            {(["ask", "ai", "basic"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={preferences.preferredMode === mode}
                className={preferences.preferredMode === mode ? "is-selected" : ""}
                onClick={() => updatePreference({ preferredMode: mode })}
              >
                {mode === "ask" ? "Perguntar" : mode === "ai" ? "IA local" : "Básico"}
              </button>
            ))}
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-heading"><strong>Companhia de foco</strong><p>Alertas só funcionam enquanto o site estiver aberto.</p></div>
          <label className="toggle-row">
            <span><strong>Notificações</strong><small>Peça status aos 10, 20 e 30 minutos.</small></span>
            <input type="checkbox" checked={preferences.notificationsEnabled} onChange={(event) => void toggleNotifications(event.target.checked)} />
            <span className="toggle-track"><span /></span>
          </label>
          <label className="toggle-row">
            <span><strong>Som</strong><small>Toque discreto nos check-ins.</small></span>
            <input type="checkbox" checked={preferences.soundEnabled} onChange={(event) => updatePreference({ soundEnabled: event.target.checked })} />
            <span className="toggle-track"><span /></span>
          </label>
        </section>

        <section className="settings-section model-section">
          <div className="settings-heading"><strong>Modelo local</strong><p>{WEBLLM_MODEL_ID}</p></div>
          <div className="model-status-row">
            <span className={`cache-status ${modelCached === true ? "is-cached" : ""}`}><span className="signal-dot" /> {modelCached === null ? "Verificando…" : modelCached === true ? "Salvo neste dispositivo" : modelCached === "error" ? "Não foi possível verificar o cache" : "Nenhum modelo completo encontrado"}</span>
            <button className="button button-secondary button-compact" type="button" onClick={() => void removeModel()} disabled={cacheBusy}>{cacheBusy ? "Limpando…" : "Limpar arquivos da IA"}</button>
          </div>
        </section>

        <section className="settings-section danger-section">
          <div className="settings-heading"><strong>Dados deste navegador</strong><p>Apaga rascunhos, histórico, preferências e timer. O modelo é removido separadamente.</p></div>
          <button className="button button-danger" type="button" onClick={clearSavedData}><Trash2 size={16} /> Apagar meus dados</button>
        </section>
      </Modal>

      {focusSession && (
        <FocusSessionDock
          key={focusSession.id}
          session={focusSession}
          now={now}
          preferences={preferences}
          deferCheckIn={Boolean(activeDefinition || consentOpen || historyOpen || settingsOpen)}
          onUpdate={(session) => {
            setFocusSession(session);
            saveFocusSession(session);
          }}
          onEnd={() => {
            clearFocusSession();
            setFocusSession(null);
            showToast("Sessão de foco encerrada.");
          }}
        />
      )}

      {toast && <div className="toast" role="status"><Check size={16} /> {toast}</div>}
    </div>
  );
}
