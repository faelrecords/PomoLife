export const LOCAL_MODELS = [
  {
    id: "Qwen3-0.6B-q4f16_1-MLC",
    name: "Qwen3 0.6B",
    recommendedRamGb: 2,
    vramMb: 1_403,
    downloadMb: 352,
  },
  {
    id: "Qwen3.5-0.8B-q4f16_1-MLC",
    name: "Qwen3.5 0.8B",
    recommendedRamGb: 3,
    vramMb: 1_629,
    downloadMb: 447,
  },
  {
    id: "Qwen3-1.7B-q4f16_1-MLC",
    name: "Qwen3 1.7B",
    recommendedRamGb: 4,
    vramMb: 2_037,
    downloadMb: 984,
  },
  {
    id: "Qwen3-4B-q4f16_1-MLC",
    name: "Qwen3 4B",
    recommendedRamGb: 8,
    vramMb: 3_432,
    downloadMb: 2_280,
  },
] as const;

export type LocalModelId = (typeof LOCAL_MODELS)[number]["id"];
export type LocalModelDefinition = (typeof LOCAL_MODELS)[number];
export const DEFAULT_LOCAL_MODEL_ID: LocalModelId = LOCAL_MODELS[0].id;

export const ONLINE_MODELS = [
  {
    id: "groq:qwen/qwen3-32b",
    providerModelId: "qwen/qwen3-32b",
    name: "Qwen3 32B",
    provider: "Groq",
  },
] as const;

export type OnlineModelId = (typeof ONLINE_MODELS)[number]["id"];
export type ModelId = LocalModelId | OnlineModelId;
export const DEFAULT_MODEL_ID: ModelId = import.meta.env.VITE_GROQ_API_KEY ? ONLINE_MODELS[0].id : DEFAULT_LOCAL_MODEL_ID;

export function isLocalModelId(value: unknown): value is LocalModelId {
  return typeof value === "string" && LOCAL_MODELS.some((model) => model.id === value);
}

export function isOnlineModelId(value: unknown): value is OnlineModelId {
  return typeof value === "string" && ONLINE_MODELS.some((model) => model.id === value);
}

export function isModelId(value: unknown): value is ModelId {
  return isLocalModelId(value) || isOnlineModelId(value);
}

export function getOnlineModel(modelId: OnlineModelId) {
  return ONLINE_MODELS.find((model) => model.id === modelId) ?? ONLINE_MODELS[0];
}

export function getLocalModel(modelId: LocalModelId): LocalModelDefinition {
  return LOCAL_MODELS.find((model) => model.id === modelId) ?? LOCAL_MODELS[0];
}
