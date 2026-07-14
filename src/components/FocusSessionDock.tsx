import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Bell, Check, Square, Target } from "lucide-react";
import {
  acknowledgeCheckpoint,
  formatCountdown,
  formatClockTime,
  getFocusTimerSnapshot,
  type FocusCheckpointMinute,
  type FocusSession,
} from "../lib/focusTimer";
import type { UserPreferences } from "../lib/storage";
import { Modal } from "./Modal";

interface FocusSessionDockProps {
  session: FocusSession;
  now: number;
  preferences: UserPreferences;
  deferCheckIn?: boolean;
  onUpdate: (session: FocusSession) => void;
  onEnd: () => void;
}

function playChime() {
  try {
    const AudioContextClass = window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(660, context.currentTime);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.35);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.38);
    oscillator.addEventListener("ended", () => void context.close(), { once: true });
  } catch {
    // Som é um aprimoramento opcional; o alerta visual permanece disponível.
  }
}

export function FocusSessionDock({ session, now, preferences, deferCheckIn = false, onUpdate, onEnd }: FocusSessionDockProps) {
  const snapshot = useMemo(() => getFocusTimerSnapshot(session, now), [now, session]);
  const due = snapshot.dueCheckpoints[0] ?? null;
  const [checkInMinute, setCheckInMinute] = useState<FocusCheckpointMinute | null>(null);
  const [statusText, setStatusText] = useState("");
  const [anchorMessage, setAnchorMessage] = useState("");
  const notifiedRef = useRef(new Set<string>());
  const openedRef = useRef(new Set<string>());

  useEffect(() => {
    if (!due) return;
    const checkpointKey = `${session.id}:${due.minute}`;

    if (!notifiedRef.current.has(checkpointKey)) {
      notifiedRef.current.add(checkpointKey);
      if (preferences.notificationsEnabled && "Notification" in window && Notification.permission === "granted") {
        try {
          new Notification(`PomoLife · ${due.minute} minutos`, {
            body: due.minute === 30 ? "Seu bloco terminou. Como foi?" : "Pausa rápida: conte como está e volte ao próximo movimento.",
            icon: `${import.meta.env.BASE_URL}favicon.svg`,
          });
        } catch {
          // O alerta visual abaixo continua disponível quando a notificação nativa falha.
        }
      }
      if (preferences.soundEnabled) playChime();
    }

    if (deferCheckIn || checkInMinute !== null || anchorMessage || openedRef.current.has(checkpointKey)) return;
    openedRef.current.add(checkpointKey);
    const openTimer = window.setTimeout(() => setCheckInMinute(due.minute), 0);
    return () => window.clearTimeout(openTimer);
  }, [anchorMessage, checkInMinute, deferCheckIn, due, preferences.notificationsEnabled, preferences.soundEnabled, session.id]);

  const acknowledge = () => {
    if (!checkInMinute) return;
    const updated = acknowledgeCheckpoint(session, checkInMinute);
    onUpdate(updated);
    if (checkInMinute === 30) {
      setAnchorMessage("Bloco concluído. Reconheça o que avançou antes de decidir o próximo passo.");
    } else {
      const status = statusText.trim();
      setAnchorMessage(
        status
          ? `Você voltou. Deixe “${status.slice(0, 90)}” estacionado por agora e retome um único movimento em ${session.task}.`
          : `Você voltou. Feche o que estiver puxando sua atenção e retome um único movimento em ${session.task}.`,
      );
    }
  };

  const closeCheckIn = () => {
    setCheckInMinute(null);
    setStatusText("");
    setAnchorMessage("");
  };

  const progressStyle = { "--focus-progress": `${snapshot.progress * 360}deg` } as CSSProperties;

  return (
    <>
      <aside className="focus-dock" aria-label="Sessão de foco em andamento">
        <div className="focus-progress" style={progressStyle} aria-hidden="true">
          <span>{formatCountdown(snapshot.remainingMs)}</span>
        </div>
        <div className="focus-dock-copy">
          <p className="focus-kicker"><span className="signal-dot" /> Bloco de foco</p>
          <strong>{session.task}</strong>
          <small>
            {snapshot.status === "completed"
              ? "Tempo concluído"
              : `Termina às ${formatClockTime(session.endsAt)}`}
          </small>
        </div>
        <div className="focus-dock-actions">
          {due && (
            <button className="button button-primary button-compact" type="button" onClick={() => {
              openedRef.current.add(`${session.id}:${due.minute}`);
              setCheckInMinute(due.minute);
            }}>
              <Bell size={16} /> Check-in
            </button>
          )}
          <button className="icon-button" type="button" aria-label="Encerrar sessão de foco" title="Encerrar sessão" onClick={onEnd}>
            <Square size={17} />
          </button>
        </div>
      </aside>

      <Modal open={checkInMinute !== null} labelledBy="focus-checkin-title" onClose={closeCheckIn} closeOnBackdrop={false} className="compact-modal">
        <div className="modal-header">
          <div>
            <p className="eyebrow"><Target size={15} /> Âncora de atenção</p>
            <h2 id="focus-checkin-title">
              {checkInMinute === 30 ? "Seu bloco terminou" : `${checkInMinute} minutos. Como está?`}
            </h2>
          </div>
        </div>

        {!anchorMessage ? (
          <div className="checkin-body">
            <label htmlFor="focus-status">Conte em uma frase o que avançou ou puxou sua atenção.</label>
            <textarea
              id="focus-status"
              rows={4}
              maxLength={300}
              value={statusText}
              onChange={(event) => setStatusText(event.target.value)}
              placeholder="Ex.: avancei dois itens e abri o e-mail sem perceber"
              data-autofocus
            />
            <button className="button button-primary" type="button" onClick={acknowledge}>
              <Check size={17} /> Registrar status
            </button>
          </div>
        ) : (
          <div className="anchor-message" aria-live="polite">
            <p>{anchorMessage}</p>
            <button
              className="button button-primary"
              type="button"
              onClick={() => {
                if (checkInMinute === 30) onEnd();
                closeCheckIn();
              }}
              data-autofocus
            >
              {checkInMinute === 30 ? "Encerrar bloco" : "Voltar ao foco"}
            </button>
          </div>
        )}
      </Modal>
    </>
  );
}
