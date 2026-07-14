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
  Bot,
  Check,
  Copy,
  Download,
  FileText,
  History,
  MessageSquarePlus,
  Orbit,
  Paperclip,
  Play,
  Send,
  Settings,
  Square,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import {
  createBasicAgentEngine,
  createWebLLMAgentEngine,
  getPomodoroPreset,
  parseAgentOutput,
  parseChecklist,
  type AgentEngine,
  type ChatAttachment,
  type ChatMessage,
  type ChatSession,
  type PomodoroPreset,
} from "./agent";
import {
  type PlannerEngineSnapshot,
} from "./engine";
import {
  AGENT_STORAGE_VERSION,
  DEFAULT_AGENT_PREFERENCES,
  clearAgentData,
  createChatSession,
  loadAgentState,
  saveAgentState,
  sessionTitleFrom,
  type AgentPreferences,
} from "./lib/chatStorage";
import { createId, createIsoNow } from "./lib/ids";
import { getLocalModel, isLocalModelId, LOCAL_MODELS } from "./lib/modelCatalog";
import { CHAT_ATTACHMENT_ACCEPT, formatAttachmentSize, readChatAttachments } from "./lib/chatAttachments";
import { createPomodoroSession, POMODORO_PRESETS, type PomodoroSession } from "./lib/pomodoro";
import { BlackHoleBackdrop } from "./components/BlackHoleBackdrop";
import { InteractiveMessage } from "./components/InteractiveMessage";
import { Modal } from "./components/Modal";
import { PomodoroDock } from "./components/PomodoroDock";
import { YouTubePlayer } from "./components/YouTubePlayer";

const INITIAL_ENGINE_SNAPSHOT: PlannerEngineSnapshot = { status: "idle", progress: null, error: null };

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function updateSessionList(sessions: ChatSession[], sessionId: string, transform: (session: ChatSession) => ChatSession): ChatSession[] {
  return sessions.map((session) => session.id === sessionId ? transform(session) : session)
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

function emptyGreeting(): ChatMessage {
  return {
    id: "welcome",
    role: "assistant",
    content: "Olá! Posso conversar sobre qualquer assunto, analisar arquivos de texto ou ajudar a transformar tarefas em passos menores quando isso for útil.",
    createdAt: createIsoNow(),
    stage: "message",
  };
}

export default function App() {
  const initial = useRef(loadAgentState()).current;
  const initialSessions = useRef(initial.sessions.length ? initial.sessions : [createChatSession()]).current;
  const [preferences, setPreferences] = useState(initial.preferences);
  const aiEngine = useMemo(() => createWebLLMAgentEngine(preferences.selectedModelId), [preferences.selectedModelId]);
  const basicEngine = useMemo(() => createBasicAgentEngine(), []);
  const aiSnapshot = useSyncExternalStore(aiEngine.subscribe, aiEngine.getSnapshot, () => INITIAL_ENGINE_SNAPSHOT);

  const [sessions, setSessions] = useState<ChatSession[]>(initialSessions);
  const [activeSessionId, setActiveSessionId] = useState(initial.activeSessionId && initialSessions.some((session) => session.id === initial.activeSessionId) ? initial.activeSessionId : initialSessions[0].id);
  const [legacyPlans, setLegacyPlans] = useState(initial.legacyPlans);
  const [pomodoro, setPomodoro] = useState<PomodoroSession | null>(initial.pomodoro);
  const [composer, setComposer] = useState("");
  const [composerAttachments, setComposerAttachments] = useState<ChatAttachment[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [previewAttachment, setPreviewAttachment] = useState<ChatAttachment | null>(null);
  const [attachmentError, setAttachmentError] = useState("");
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pendingText, setPendingText] = useState("");
  const [pendingFocusTask, setPendingFocusTask] = useState("");
  const [selectedPreset, setSelectedPreset] = useState<PomodoroPreset>({ focusMinutes: 25, breakMinutes: 5 });
  const [modelCached, setModelCached] = useState<boolean | "error" | null>(null);
  const [cacheBusy, setCacheBusy] = useState(false);
  const [toast, setToast] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sessionsRef = useRef(sessions);
  const endRef = useRef<HTMLDivElement>(null);

  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? sessions[0];
  const selectedModel = getLocalModel(preferences.selectedModelId);
  const busy = isGenerating || aiSnapshot.status === "downloading" || aiSnapshot.status === "loading";

  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);
  useEffect(() => {
    setComposer("");
    setComposerAttachments([]);
    setPendingText("");
    setPendingAttachments([]);
    setAttachmentError("");
    setConsentOpen(false);
  }, [activeSessionId]);
  useEffect(() => {
    saveAgentState({ version: AGENT_STORAGE_VERSION, sessions, activeSessionId, legacyPlans, preferences, pomodoro });
  }, [activeSessionId, legacyPlans, pomodoro, preferences, sessions]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [activeSession?.messages, isGenerating]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => () => { abortRef.current?.abort(); void aiEngine.dispose(); }, [aiEngine]);
  useEffect(() => () => { void basicEngine.dispose(); }, [basicEngine]);
  useEffect(() => {
    let active = true;
    setModelCached(null);
    void aiEngine.hasModelInCache()
      .then((cached) => { if (active) setModelCached(cached); })
      .catch(() => { if (active) setModelCached("error"); });
    return () => { active = false; };
  }, [aiEngine]);

  const patchPreferences = useCallback((patch: Partial<AgentPreferences>) => {
    setPreferences((current) => ({ ...current, ...patch }));
  }, []);

  const newConversation = () => {
    const session = createChatSession();
    setSessions((current) => [session, ...current].slice(0, 20));
    setActiveSessionId(session.id);
    setComposer("");
    setComposerAttachments([]);
    setAttachmentError("");
  };

  const sendThroughEngine = useCallback(async (text: string, engine: AgentEngine, attachments: readonly ChatAttachment[] = []) => {
    const session = sessionsRef.current.find((item) => item.id === activeSessionId);
    if (!session || isGenerating) return;
    const now = createIsoNow();
    const messageText = text.trim() || "Analise os arquivos anexados.";
    const userMessage: ChatMessage = {
      id: createId("message"),
      role: "user",
      content: messageText,
      createdAt: now,
      attachments: attachments.length ? [...attachments] : undefined,
    };
    const assistantId = createId("message");
    const assistantPlaceholder: ChatMessage = { id: assistantId, role: "assistant", content: "", createdAt: now, mode: engine.mode };
    const requestMessages = [...session.messages, userMessage];
    const titleSource = text.trim() || attachments.map((attachment) => attachment.name).join(", ");
    const nextTitle = session.messages.some((message) => message.role === "user") ? session.title : sessionTitleFrom(titleSource);
    setSessions((current) => updateSessionList(current, session.id, (item) => ({ ...item, title: nextTitle, messages: [...item.messages, userMessage, assistantPlaceholder].slice(-50), updatedAt: now })));
    setComposer("");
    setComposerAttachments([]);
    setPendingText("");
    setPendingAttachments([]);
    setAttachmentError("");
    setIsGenerating(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await engine.sendMessage({ messages: requestMessages, checklist: session.checklist }, {
        signal: controller.signal,
        onToken: (_delta, complete) => {
          const visible = parseAgentOutput(complete).text;
          setSessions((current) => updateSessionList(current, session.id, (item) => ({
            ...item,
            messages: item.messages.map((message) => message.id === assistantId ? { ...message, content: visible } : message),
            updatedAt: createIsoNow(),
          })));
        },
      });
      if (result.cancelled) return;
      const parsed = parseAgentOutput(result.text);
      const checklist = parseChecklist(assistantId, parsed.text);
      setSessions((current) => updateSessionList(current, session.id, (item) => ({
        ...item,
        messages: item.messages.map((message) => message.id === assistantId ? { ...message, content: parsed.text, mode: result.mode, stage: parsed.stage } : message),
        checklist: [...item.checklist.filter((task) => task.messageId !== assistantId), ...checklist],
        activeContext: parsed.stage === "plan" ? parsed.text.slice(0, 2_000) : item.activeContext,
        updatedAt: createIsoNow(),
      })));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "A geração local foi interrompida.";
      setSessions((current) => updateSessionList(current, session.id, (item) => ({
        ...item,
        messages: item.messages.map((entry) => entry.id === assistantId ? { ...entry, content: `Não consegui concluir esta resposta localmente. **${message}**\n\nVocê pode tentar novamente ou usar o modo básico.`, stage: "message" } : entry),
        updatedAt: createIsoNow(),
      })));
    } finally {
      setIsGenerating(false);
      abortRef.current = null;
    }
  }, [activeSessionId, isGenerating]);

  const prepareAIAndSend = async (text: string, attachments: readonly ChatAttachment[] = pendingAttachments) => {
    try {
      await aiEngine.initialize();
      setModelCached(true);
      patchPreferences({ preferredMode: "ai" });
      setConsentOpen(false);
      setPendingText("");
      setPendingAttachments([]);
      await sendThroughEngine(text, aiEngine, attachments);
    } catch {
      setPendingText(text);
      setPendingAttachments([...attachments]);
      setConsentOpen(true);
      setToast("A IA local não pôde ser carregada. O modo básico continua disponível.");
    }
  };

  const requestSend = (event?: FormEvent) => {
    event?.preventDefault();
    const text = composer.trim();
    const attachments = [...composerAttachments];
    if ((!text && !attachments.length) || busy || attachmentBusy) return;
    if (preferences.preferredMode === "basic" && (aiSnapshot.status === "error" || aiSnapshot.status === "unsupported")) { void sendThroughEngine(text, basicEngine, attachments); return; }
    if (aiSnapshot.status === "ready") { void sendThroughEngine(text, aiEngine, attachments); return; }
    setPendingText(text);
    setPendingAttachments(attachments);
    if (aiSnapshot.status === "unsupported" || aiSnapshot.status === "error") { setConsentOpen(true); return; }
    if (modelCached === true) { void prepareAIAndSend(text, attachments); return; }
    if (modelCached === false) { setConsentOpen(true); return; }
    void aiEngine.hasModelInCache().then((cached) => {
      setModelCached(cached);
      if (cached) void prepareAIAndSend(text, attachments);
      else setConsentOpen(true);
    }).catch(() => setConsentOpen(true));
  };

  const activateAI = async () => {
    if (navigator.storage?.persist) void navigator.storage.persist().catch(() => false);
    if (pendingText || pendingAttachments.length) await prepareAIAndSend(pendingText, pendingAttachments);
  };

  const selectBasicMode = async () => {
    patchPreferences({ preferredMode: "basic" });
    setConsentOpen(false);
    const text = pendingText || composer.trim();
    const attachments = pendingAttachments.length ? pendingAttachments : composerAttachments;
    setPendingText("");
    setPendingAttachments([]);
    if (text || attachments.length) await sendThroughEngine(text, basicEngine, attachments);
  };

  const toggleChecklist = (id: string) => {
    setSessions((current) => updateSessionList(current, activeSessionId, (session) => ({
      ...session,
      checklist: session.checklist.map((item) => item.id === id ? { ...item, completed: !item.completed } : item),
      updatedAt: createIsoNow(),
    })));
  };

  const prepareFocus = (task: string) => {
    const lastPlan = [...(activeSession?.messages ?? [])].reverse().find((message) => message.role === "assistant" && message.stage === "plan");
    setSelectedPreset(getPomodoroPreset(lastPlan?.content ?? ""));
    setPendingFocusTask(task);
  };

  const beginPomodoro = async () => {
    if (preferences.notificationsEnabled && "Notification" in window && Notification.permission === "default") await Notification.requestPermission();
    setPomodoro(createPomodoroSession(pendingFocusTask, selectedPreset));
    setPendingFocusTask("");
    setToast("Bloco de foco iniciado.");
  };

  const appendCheckIn = (status: string) => {
    const message: ChatMessage = { id: createId("message"), role: "user", content: `Check-in do Pomodoro: ${status}`, createdAt: createIsoNow() };
    setSessions((current) => updateSessionList(current, activeSessionId, (session) => ({ ...session, messages: [...session.messages, message].slice(-50), updatedAt: message.createdAt })));
  };

  const copyMessage = async (content: string) => {
    await navigator.clipboard.writeText(content);
    setToast("Resposta copiada.");
  };

  const addAttachments = async (fileList: FileList | null) => {
    if (!fileList?.length || attachmentBusy) return;
    setAttachmentBusy(true);
    try {
      const result = await readChatAttachments([...fileList], composerAttachments);
      setComposerAttachments(result.attachments);
      setAttachmentError(result.errors.join(" "));
    } finally {
      setAttachmentBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeAttachment = (attachmentId: string) => {
    setComposerAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
    setAttachmentError("");
  };

  const deleteSession = (sessionId: string) => {
    if (!window.confirm("Excluir esta conversa deste navegador?")) return;
    setSessions((current) => {
      const remaining = current.filter((session) => session.id !== sessionId);
      if (remaining.length) {
        if (activeSessionId === sessionId) setActiveSessionId(remaining[0].id);
        return remaining;
      }
      const replacement = createChatSession();
      setActiveSessionId(replacement.id);
      return [replacement];
    });
  };

  const clearModel = async () => {
    setCacheBusy(true);
    try { await aiEngine.clearModelCache(); setModelCached(false); setToast("Arquivos do modelo removidos."); }
    catch { setToast("Não foi possível remover o modelo agora."); }
    finally { setCacheBusy(false); }
  };

  return (
    <div className={`app-shell ${busy ? "is-busy" : ""}`}>
      <a className="skip-link" href="#chat-composer">Pular para o chat</a>
      <BlackHoleBackdrop paused={busy} />

      <header className="site-header">
        <a className="brand-lockup" href={import.meta.env.BASE_URL} aria-label="PomoLife, início">
          <span className="brand-mark"><Orbit size={22} strokeWidth={1.5} /></span>
          <span className="brand-copy"><strong>PomoLife</strong><small>Vibecodex</small></span>
        </a>
        <YouTubePlayer initialUrl={preferences.youtubeUrl} initialVolume={preferences.youtubeVolume} onPreferenceChange={(youtubeUrl, youtubeVolume) => patchPreferences({ youtubeUrl, youtubeVolume })} />
        <div className="header-actions">
          <button className="icon-button" type="button" aria-label="Configurações" title="Configurações" onClick={() => setSettingsOpen(true)}><Settings size={18} /></button>
        </div>
      </header>

      <main className="workspace">
        <aside className="chat-sidebar" aria-label="Conversas criadas">
          <div className="sidebar-heading"><span><History size={14} /> Conversas</span><button className="icon-button icon-button-small" type="button" aria-label="Criar conversa" onClick={newConversation}><MessageSquarePlus size={15} /></button></div>
          <nav className="sidebar-conversations">
            {sessions.map((session) => (
              <div key={session.id} className={`sidebar-conversation-item ${session.id === activeSessionId ? "is-active" : ""}`}>
                <button className="sidebar-conversation-open" type="button" onClick={() => setActiveSessionId(session.id)}>
                  <span>{session.title}</span><small>{session.messages.length} mensagens</small>
                </button>
                <button className="sidebar-conversation-delete" type="button" aria-label={`Excluir ${session.title}`} title="Excluir conversa" onClick={() => deleteSession(session.id)}><Trash2 size={14} /></button>
              </div>
            ))}
          </nav>
        </aside>
        <section className="chat-shell" aria-labelledby="chat-title">
          <div className="chat-topbar">
            <div><p className="eyebrow"><span className="signal-dot" /> Assistente PomoLife</p><h1 id="chat-title">{activeSession?.title ?? "Nova conversa"}</h1></div>
          </div>

          <div className="chat-messages" aria-live="polite" aria-busy={isGenerating}>
            {(activeSession?.messages.length ? activeSession.messages : [emptyGreeting()]).map((message) => (
              <article key={message.id} className={`chat-message message-${message.role}`}>
                <div className="message-avatar">{message.role === "assistant" ? <Bot size={18} /> : <UserRound size={18} />}</div>
                <div className="message-body">
                  <div className="message-meta"><strong>{message.role === "assistant" ? "PomoLife" : "Você"}</strong><span>{message.id === "welcome" ? "agora" : formatDate(message.createdAt)}</span>{message.mode && <small>{message.mode === "ai" ? "IA local" : "Plano básico"}</small>}</div>
                  {message.content ? <InteractiveMessage message={message} checklist={activeSession?.checklist ?? []} onToggle={toggleChecklist} onStart={prepareFocus} /> : <div className="typing-indicator"><span /><span /><span /><em>Pensando…</em></div>}
                  {message.attachments?.length ? <div className="message-attachments" aria-label="Arquivos anexados">{message.attachments.map((attachment) => <button key={attachment.id} type="button" onClick={() => setPreviewAttachment(attachment)} aria-label={`Visualizar arquivo ${attachment.name}`}><FileText size={14} /><span><strong>{attachment.name}</strong><small>{formatAttachmentSize(attachment.size)}</small></span></button>)}</div> : null}
                  {message.role === "assistant" && message.content && message.id !== "welcome" && <button className="message-copy" type="button" onClick={() => void copyMessage(message.content)}><Copy size={13} /> Copiar</button>}
                </div>
              </article>
            ))}
            <div ref={endRef} />
          </div>

          <form className="chat-composer" onSubmit={requestSend}>
            <label htmlFor="chat-composer" className="sr-only">Descreva sua tarefa</label>
            <textarea
              id="chat-composer"
              value={composer}
              onChange={(event) => setComposer(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); requestSend(); } }}
              rows={3}
              maxLength={5_000}
              placeholder="Envie uma mensagem ou descreva no que você precisa de ajuda…"
              disabled={busy || attachmentBusy}
            />
            {composerAttachments.length ? <div className="composer-attachments" aria-label="Anexos desta mensagem">{composerAttachments.map((attachment) => <div className="composer-attachment" key={attachment.id}><button className="composer-attachment-preview" type="button" onClick={() => setPreviewAttachment(attachment)} aria-label={`Visualizar arquivo ${attachment.name}`}><FileText size={15} /><span><strong>{attachment.name}</strong><small>{formatAttachmentSize(attachment.size)}{attachment.truncated ? " · trecho local" : ""}</small></span></button><button className="composer-attachment-remove" type="button" onClick={() => removeAttachment(attachment.id)} aria-label={`Remover arquivo ${attachment.name}`}><X size={14} /></button></div>)}</div> : null}
            {attachmentError && <p className="attachment-error" role="alert">{attachmentError}</p>}
            <div className="composer-footer">
              <div className="composer-tools">
                <input ref={fileInputRef} className="sr-only" type="file" multiple accept={CHAT_ATTACHMENT_ACCEPT} aria-label="Selecionar arquivos de texto" onChange={(event) => void addAttachments(event.target.files)} />
                <button className="composer-attach-button" type="button" disabled={busy || attachmentBusy} aria-label="Anexar arquivos" title="Anexar arquivos de texto" onClick={() => fileInputRef.current?.click()}><Paperclip size={16} /><span>{attachmentBusy ? "Lendo…" : "Anexar"}</span></button>
                <label className="composer-model-selector"><span className="sr-only">Modelo</span><select aria-label="Modelo de IA" value={preferences.selectedModelId} disabled={busy || isGenerating} onChange={(event) => { if (isLocalModelId(event.target.value)) patchPreferences({ selectedModelId: event.target.value, preferredMode: "ask" }); }}>{LOCAL_MODELS.map((model) => <option key={model.id} value={model.id}>{model.name} — {model.recommendedRamGb} GB RAM</option>)}</select></label>
              </div>
              {isGenerating ? (
                <button className="button button-secondary" type="button" onClick={() => { abortRef.current?.abort(); void aiEngine.cancel(); void basicEngine.cancel(); }}><Square size={14} /> Parar</button>
              ) : (
                <button className="composer-send-button" type="submit" aria-label="Enviar" title="Enviar" disabled={(!composer.trim() && !composerAttachments.length) || busy || attachmentBusy}><Send size={17} /></button>
              )}
            </div>
          </form>
        </section>

        <aside className="checklist-sidebar" aria-label={`Checklist de ${activeSession?.title ?? "conversa atual"}`}>
          <div className="checklist-panel">
            <div className="progress-heading"><span><Check size={15} /> Checklist</span><strong>{activeSession?.checklist.filter((item) => item.completed).length ?? 0}/{activeSession?.checklist.length ?? 0}</strong></div>
            <div className="progress-track"><span style={{ width: `${activeSession?.checklist.length ? (activeSession.checklist.filter((item) => item.completed).length / activeSession.checklist.length) * 100 : 0}%` }} /></div>
            <div className="sidebar-checklist">
              {activeSession?.checklist.length ? activeSession.checklist.map((item) => (
                <div className={item.completed ? "is-complete" : ""} key={item.id}>
                  <label><input type="checkbox" checked={item.completed} onChange={() => toggleChecklist(item.id)} /><span>{item.text}</span></label>
                  <button className="sidebar-task-start" type="button" aria-label={`Focar em ${item.text}`} onClick={() => prepareFocus(item.text)}><Play size={13} /></button>
                </div>
              )) : <p className="empty-checklist">As tarefas desta conversa aparecerão aqui quando houver um checklist.</p>}
            </div>
          </div>
        </aside>
      </main>

      <footer className="site-footer"><span>© {new Date().getFullYear()} PomoLife · Fael Records</span><span>Apoio à organização; não substitui acompanhamento profissional.</span></footer>

      <Modal open={Boolean(previewAttachment)} labelledBy="attachment-preview-title" onClose={() => setPreviewAttachment(null)} className="compact-modal attachment-preview-modal">
        <div className="modal-header"><div><p className="eyebrow"><FileText size={14} /> Anexo local</p><h2 id="attachment-preview-title">{previewAttachment?.name}</h2></div><button className="icon-button" type="button" aria-label="Fechar visualização" onClick={() => setPreviewAttachment(null)}><X size={18} /></button></div>
        {previewAttachment && <><div className="attachment-preview-meta"><span>{formatAttachmentSize(previewAttachment.size)}</span><span>{previewAttachment.mimeType}</span>{previewAttachment.truncated && <span>Trecho reduzido para a análise local</span>}</div><pre className="attachment-preview-content">{previewAttachment.text}</pre></>}
      </Modal>

      <Modal open={consentOpen} labelledBy="consent-title" onClose={() => { if (!busy) setConsentOpen(false); }} className="compact-modal consent-modal">
        <div className="modal-header"><div className="consent-icon"><Download size={22} /></div><button className="icon-button" type="button" aria-label="Fechar" disabled={busy} onClick={() => setConsentOpen(false)}><X size={18} /></button></div>
        <div className="consent-copy">
          <p className="eyebrow"><span className="signal-dot" /> Primeira mensagem</p><h2 id="consent-title">Baixar a IA local?</h2>
          <p>O {selectedModel.name} será baixado uma única vez e executado neste dispositivo. Depois, o navegador reutiliza os arquivos salvos.</p>
          <dl className="model-facts"><div><dt>Download</dt><dd>≈ {selectedModel.downloadMb >= 1_000 ? `${(selectedModel.downloadMb / 1_000).toFixed(2)} GB` : `${selectedModel.downloadMb} MB`}</dd></div><div><dt>Memória recomendada</dt><dd>{selectedModel.recommendedRamGb} GB RAM</dd></div><div><dt>Modelo</dt><dd>{selectedModel.name}</dd></div></dl>
          {(aiSnapshot.status === "downloading" || aiSnapshot.status === "loading") && aiSnapshot.progress && <div className="download-progress"><div className="progress-label"><span>{aiSnapshot.status === "downloading" ? "Baixando modelo" : "Preparando GPU"}</span><strong>{Math.round(aiSnapshot.progress.value * 100)}%</strong></div><div className="progress-track"><span style={{ width: `${aiSnapshot.progress.value * 100}%` }} /></div><small>{aiSnapshot.progress.message}</small></div>}
          {aiSnapshot.status === "unsupported" && <p className="field-error" role="alert">Este navegador não oferece WebGPU para executar o modelo. O modo básico continua disponível.</p>}
          {aiSnapshot.error && <p className="field-error" role="alert">{aiSnapshot.error.message}</p>}
          <div className="dialog-actions">
            {aiSnapshot.status !== "unsupported" && <button className="button button-primary" type="button" onClick={() => void activateAI()} disabled={busy}><Download size={16} /> {busy ? "Preparando…" : "Baixar e ativar IA"}</button>}
            {(aiSnapshot.status === "error" || aiSnapshot.status === "unsupported") && <button className="button button-secondary" type="button" onClick={() => void selectBasicMode()}>Continuar no modo básico</button>}
          </div>
        </div>
      </Modal>

      <Modal open={settingsOpen} labelledBy="settings-title" onClose={() => setSettingsOpen(false)} className="side-modal settings-modal">
        <div className="modal-header"><div><p className="eyebrow"><Settings size={14} /> Controle local</p><h2 id="settings-title">Configurações</h2></div><button className="icon-button" type="button" aria-label="Fechar" onClick={() => setSettingsOpen(false)}><X size={18} /></button></div>
        <section className="settings-section"><div className="settings-heading"><strong>Pomodoro</strong><p>Alertas funcionam enquanto o site estiver aberto.</p></div><label className="toggle-row"><span><strong>Notificações</strong><small>Check-in no meio e no fim do bloco.</small></span><input type="checkbox" checked={preferences.notificationsEnabled} onChange={(event) => patchPreferences({ notificationsEnabled: event.target.checked })} /><span className="toggle-track"><span /></span></label><label className="toggle-row"><span><strong>Som discreto</strong><small>Um sinal curto nos check-ins.</small></span><input type="checkbox" checked={preferences.soundEnabled} onChange={(event) => patchPreferences({ soundEnabled: event.target.checked })} /><span className="toggle-track"><span /></span></label></section>
        <section className="settings-section"><div className="settings-heading"><strong>Modelo local selecionado</strong><p>{selectedModel.name} · cada modelo é salvo apenas uma vez por navegador e domínio.</p></div><span className="cache-status"><span className="signal-dot" /> {modelCached === null ? "Verificando…" : modelCached === true ? "Salvo neste dispositivo" : modelCached === "error" ? "Não foi possível verificar" : "Ainda não baixado"}</span>{modelCached === true && <button className="button button-secondary full-button" type="button" disabled={cacheBusy} onClick={() => void clearModel()}>{cacheBusy ? "Removendo…" : "Remover modelo selecionado"}</button>}</section>
        <section className="settings-section danger-section"><div className="settings-heading"><strong>Dados deste navegador</strong><p>Apaga conversas, checklists, preferências, planos antigos e timer. O modelo é removido separadamente.</p></div><button className="button button-danger full-button" type="button" onClick={() => { if (window.confirm("Apagar todos os dados locais do PomoLife?")) { clearAgentData(); const replacement = createChatSession(); setSessions([replacement]); setActiveSessionId(replacement.id); setLegacyPlans([]); setPreferences({ ...DEFAULT_AGENT_PREFERENCES }); setPomodoro(null); setSettingsOpen(false); setToast("Dados locais apagados."); } }}><Trash2 size={15} /> Apagar meus dados</button></section>
      </Modal>

      <Modal open={Boolean(pendingFocusTask)} labelledBy="focus-start-title" onClose={() => setPendingFocusTask("")} className="compact-modal">
        <div className="focus-start"><p className="eyebrow"><Play size={14} /> Proteger atenção</p><h2 id="focus-start-title">Iniciar um bloco de foco?</h2><p>{pendingFocusTask}</p><div className="preset-grid">{POMODORO_PRESETS.map((preset) => <button type="button" key={`${preset.focusMinutes}/${preset.breakMinutes}`} className={selectedPreset.focusMinutes === preset.focusMinutes ? "is-selected" : ""} onClick={() => setSelectedPreset(preset)}><strong>{preset.focusMinutes} min</strong><span>pausa de {preset.breakMinutes}</span></button>)}</div><button className="button button-primary full-button" type="button" onClick={() => void beginPomodoro()}><Play size={16} /> Começar agora</button></div>
      </Modal>

      {pomodoro && <PomodoroDock session={pomodoro} notificationsEnabled={preferences.notificationsEnabled} soundEnabled={preferences.soundEnabled} onChange={setPomodoro} onCheckIn={appendCheckIn} onEnd={() => { setPomodoro(null); setToast("Pomodoro encerrado."); }} />}
      {toast && <div className="toast" role="status"><Check size={15} /> {toast}</div>}
    </div>
  );
}
