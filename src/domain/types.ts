export const PROMPT_IDS = [
  "paralysis",
  "dopamine",
  "focus",
  "transition",
  "game",
  "time",
  "brain-dump",
] as const;

export type PromptId = (typeof PROMPT_IDS)[number];

export type FormValues = Record<string, string>;

export type FieldType = "text" | "textarea" | "number" | "select";

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldDefinition<TName extends string = string> {
  name: TName;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  helperText?: string;
  initialValue?: string;
  maxLength?: number;
  min?: number;
  max?: number;
  step?: number;
  rows?: number;
  options?: readonly FieldOption[];
}

export interface GenerationOptions {
  temperature: number;
  maxTokens: number;
}

export type ValidationErrors = Record<string, string>;

export interface PromptDefinition<TValues extends FormValues = FormValues> {
  id: PromptId;
  number: `0${1 | 2 | 3 | 4 | 5 | 6 | 7}`;
  slug: string;
  title: string;
  description: string;
  fields: readonly FieldDefinition<Extract<keyof TValues, string>>[];
  generation: GenerationOptions;
  validate: (values: TValues) => ValidationErrors;
  buildPrompt: (values: TValues) => string;
  createFallback: (values: TValues) => string;
}

export type PlanMode = "ai" | "basic";

export interface PlanRecord {
  id: string;
  promptId: PromptId;
  promptTitle: string;
  values: FormValues;
  result: string;
  mode: PlanMode;
  createdAt: string;
}

export interface PromptMessage {
  role: "system" | "user";
  content: string;
}
