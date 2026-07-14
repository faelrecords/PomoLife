import {
  ArrowLeftRight,
  Brain,
  Clock3,
  Gamepad2,
  Hand,
  TimerReset,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { PromptId } from "../domain";

const ICONS: Record<PromptId, LucideIcon> = {
  paralysis: Hand,
  dopamine: Zap,
  focus: TimerReset,
  transition: ArrowLeftRight,
  game: Gamepad2,
  time: Clock3,
  "brain-dump": Brain,
};

export function PromptIcon({ id, size = 24 }: { id: PromptId; size?: number }) {
  const Icon = ICONS[id];
  return <Icon size={size} strokeWidth={1.55} aria-hidden="true" />;
}

