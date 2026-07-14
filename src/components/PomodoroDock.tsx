import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Pause, TimerReset, X } from "lucide-react";
import { formatRemaining, pomodoroRemaining, startBreak, type PomodoroSession } from "../lib/pomodoro";
import { Modal } from "./Modal";

interface PomodoroDockProps {
  session: PomodoroSession;
  notificationsEnabled: boolean;
  soundEnabled: boolean;
  onChange: (session: PomodoroSession) => void;
  onCheckIn: (status: string) => void;
  onEnd: () => void;
}

function beep() {
  try {
    const AudioContextClass = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 660;
    gain.gain.value = 0.035;
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.12);
  } catch { /* som é opcional */ }
}

export function PomodoroDock({ session, notificationsEnabled, soundEnabled, onChange, onCheckIn, onEnd }: PomodoroDockProps) {
  const [now, setNow] = useState(session.startedAt);
  const [status, setStatus] = useState("");
  const announcedRef = useRef("");
  const remaining = pomodoroRemaining(session, now);
  const completed = remaining === 0;
  const checkInDue = session.phase === "focus" && !session.checkInAcknowledged && now >= session.checkInAt && !completed;
  const duration = (session.endsAt - session.startedAt) || 1;
  const progress = Math.min(1, Math.max(0, 1 - remaining / duration));

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = window.setInterval(tick, 1_000);
    document.addEventListener("visibilitychange", tick);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, []);

  useEffect(() => {
    const announcementKey = completed
      ? `${session.id}:${session.phase}:complete:${session.endsAt}`
      : checkInDue
        ? `${session.id}:checkin:${session.checkInAt}`
        : "";
    if (!announcementKey || announcedRef.current === announcementKey) return;
    announcedRef.current = announcementKey;
    if (soundEnabled) beep();
    if (notificationsEnabled && Notification.permission === "granted") {
      new Notification(completed ? "Bloco concluído" : "Check-in PomoLife", { body: completed ? session.task : "O que avançou? Volte só ao próximo passo." });
    }
  }, [checkInDue, completed, notificationsEnabled, session.checkInAt, session.endsAt, session.id, session.phase, session.task, soundEnabled]);

  const label = useMemo(() => session.phase === "focus" ? "Bloco de foco" : "Pausa", [session.phase]);
  return (
    <>
      <aside className="pomodoro-dock" aria-label="Pomodoro em andamento">
        <div className="pomodoro-ring" style={{ "--progress": `${progress * 360}deg` } as React.CSSProperties}><span>{formatRemaining(remaining)}</span></div>
        <div className="pomodoro-copy"><small><TimerReset size={13} /> {label}</small><strong>{session.task}</strong><span>{session.focusMinutes}/{session.breakMinutes} · horário absoluto</span></div>
        <button className="icon-button" type="button" aria-label="Encerrar Pomodoro" onClick={onEnd}><X size={18} /></button>
      </aside>

      <Modal open={checkInDue} labelledBy="pomodoro-checkin-title" onClose={() => undefined} closeOnBackdrop={false} className="compact-modal">
        <div className="focus-dialog">
          <p className="eyebrow"><span className="signal-dot" /> Reancoragem</p>
          <h2 id="pomodoro-checkin-title">O que avançou até aqui?</h2>
          <p>Uma frase basta. Se desviou, não precisa compensar: volte ao menor próximo passo.</p>
          <textarea value={status} onChange={(event) => setStatus(event.target.value)} rows={3} maxLength={400} placeholder="Ex.: terminei dois slides; travei procurando a imagem." data-autofocus />
          <button className="button button-primary" type="button" onClick={() => {
            onCheckIn(status.trim() || "Check-in concluído; vou voltar ao próximo passo.");
            onChange({ ...session, checkInAcknowledged: true });
            setStatus("");
          }}><Check size={16} /> Voltar ao foco</button>
        </div>
      </Modal>

      <Modal open={completed} labelledBy="pomodoro-complete-title" onClose={() => undefined} closeOnBackdrop={false} className="compact-modal">
        <div className="focus-dialog">
          <p className="eyebrow"><span className="signal-dot" /> Ciclo concluído</p>
          <h2 id="pomodoro-complete-title">{session.phase === "focus" ? "Hora de soltar a tarefa." : "Pausa concluída."}</h2>
          <p>{session.phase === "focus" ? `Você protegeu ${session.focusMinutes} minutos para ${session.task}.` : "Escolha conscientemente se vai iniciar outro bloco."}</p>
          <div className="dialog-actions">
            {session.phase === "focus" && <button className="button button-primary" type="button" onClick={() => onChange(startBreak(session))}><Pause size={16} /> Iniciar pausa de {session.breakMinutes} min</button>}
            <button className="button button-secondary" type="button" onClick={onEnd}>Encerrar</button>
          </div>
        </div>
      </Modal>
    </>
  );
}
