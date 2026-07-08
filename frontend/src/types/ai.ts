export interface AiConfig {
  apiKey: string
  model: string
  baseUrl: string
  enabled: boolean
  /** 服务商标识，用于切换预设 */
  provider?: string
  /** 自定义 baseUrl 开关 */
  customBaseUrl?: boolean
}

/** AI 服务商预定义配置 */
export interface AiProvider {
  id: string
  name: string
  baseUrl: string
  models: AiProviderModel[]
  defaultModel: string
  icon?: string
  description?: string
}

export interface AiProviderModel {
  value: string
  label: string
  free?: boolean
  description?: string
}

/**
 * 预设服务商列表
 * 数据来源：各平台 API/文档实时查询 (2026-07-08)
 * API 拉取成功时会自动替换为最新数据，此处为离线兜底
 */
export const AI_PROVIDERS: AiProvider[] = [
  // ─── OpenRouter ───
  // 实时数据: GET /api/v1/models → 343 总模型, 31 免费
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    description: '聚合 343 个模型，31 个免费可用',
    defaultModel: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    models: [
      {
        value: 'nvidia/nemotron-3-ultra-550b-a55b:free',
        label: 'Nemotron 3 Ultra 550B',
        free: true,
      },
      {
        value: 'nvidia/nemotron-3-super-120b-a12b:free',
        label: 'Nemotron 3 Super 120B',
        free: true,
      },
      { value: 'nvidia/nemotron-3-nano-30b-a3b:free', label: 'Nemotron 3 Nano 30B', free: true },
      {
        value: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
        label: 'Nemotron 3 Nano Omni',
        free: true,
      },
      { value: 'nvidia/nemotron-nano-9b-v2:free', label: 'Nemotron Nano 9B V2', free: true },
      { value: 'nvidia/nemotron-nano-12b-v2-vl:free', label: 'Nemotron Nano 12B VL', free: true },
      { value: 'qwen/qwen3-coder:free', label: 'Qwen3 Coder 480B A35B', free: true },
      { value: 'qwen/qwen3-next-80b-a3b-instruct:free', label: 'Qwen3 Next 80B', free: true },
      { value: 'tencent/hy3:free', label: 'Tencent Hy3', free: true },
      { value: 'google/gemma-4-31b-it:free', label: 'Google Gemma 4 31B', free: true },
      { value: 'google/gemma-4-26b-a4b-it:free', label: 'Google Gemma 4 26B A4B', free: true },
      { value: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Meta Llama 3.3 70B', free: true },
      { value: 'meta-llama/llama-3.2-3b-instruct:free', label: 'Meta Llama 3.2 3B', free: true },
      { value: 'openai/gpt-oss-120b:free', label: 'OpenAI GPT-OSS 120B', free: true },
      { value: 'openai/gpt-oss-20b:free', label: 'OpenAI GPT-OSS 20B', free: true },
      {
        value: 'nousresearch/hermes-3-llama-3.1-405b:free',
        label: 'Nous Hermes 3 405B',
        free: true,
      },
      { value: 'poolside/laguna-m.1:free', label: 'Poolside Laguna M.1', free: true },
      { value: 'poolside/laguna-xs-2.1:free', label: 'Poolside Laguna XS 2.1', free: true },
      { value: 'poolside/laguna-xs.2:free', label: 'Poolside Laguna XS.2', free: true },
      { value: 'cohere/north-mini-code:free', label: 'Cohere North Mini Code', free: true },
      {
        value: 'cognitivecomputations/dolphin-mistral-24b-venice-edition:free',
        label: 'Venice Uncensored 24B',
        free: true,
      },
      { value: 'liquid/lfm-2.5-1.2b-instruct:free', label: 'LiquidAI LFM2.5 1.2B', free: true },
      { value: 'openrouter/free', label: 'Free Router (自动选免费模型)', free: true },
    ],
  },
  // ─── Groq ───
  // 来源: https://console.groq.com/docs/models (Playwright 抓取)
  {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    description: '超快推理速度，注册即送免费额度',
    defaultModel: 'llama-3.3-70b-versatile',
    models: [
      {
        value: 'llama-3.3-70b-versatile',
        label: 'Llama 3.3 70B',
        free: true,
        description: '通用，推荐',
      },
      { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B', free: true, description: '极速' },
      { value: 'gemma2-9b-it', label: 'Gemma 2 9B', free: true, description: 'Google' },
      { value: 'llama-guard-3-8b', label: 'Llama Guard 3 8B', free: true, description: '安全过滤' },
    ],
  },
  // ─── Cerebras ───
  // 来源: https://inference-docs.cerebras.ai
  {
    id: 'cerebras',
    name: 'Cerebras',
    baseUrl: 'https://api.cerebras.ai/v1',
    description: '极速推理，注册送免费额度',
    defaultModel: 'llama-3.3-70b',
    models: [
      { value: 'llama-3.3-70b', label: 'Llama 3.3 70B', free: true, description: '通用' },
      { value: 'llama-3.1-8b', label: 'Llama 3.1 8B', free: true, description: '极速' },
    ],
  },
  // ─── DeepSeek ───
  // 来源: https://api-docs.deepseek.com/quick_start/pricing (Playwright 抓取)
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    description: 'DeepSeek V4 系列，R1 推理模型',
    defaultModel: 'deepseek-chat',
    models: [
      { value: 'deepseek-chat', label: 'DeepSeek V4', description: '最新旗舰，对话/编程' },
      { value: 'deepseek-reasoner', label: 'DeepSeek R1', description: '推理增强' },
      { value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', description: '轻量快速' },
      { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', description: '专业版' },
    ],
  },
  // ─── Google Gemini ───
  // 来源: https://ai.google.dev/gemini-api/docs/models (Playwright 抓取)
  {
    id: 'google',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    description: 'Gemini 系列，Flash 免费，Pro 有免费额度',
    defaultModel: 'gemini-2.5-flash',
    models: [
      {
        value: 'gemini-3.5-flash',
        label: 'Gemini 3.5 Flash',
        free: true,
        description: '最新 Flash',
      },
      { value: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro', free: true, description: '最新 Pro' },
      { value: 'gemini-3.1-flash', label: 'Gemini 3.1 Flash', free: true, description: '新一代' },
      { value: 'gemini-3-flash', label: 'Gemini 3 Flash', free: true, description: '快速' },
      { value: 'gemini-3-preview', label: 'Gemini 3 Preview', free: true, description: '预览' },
      { value: 'gemini-3-stable', label: 'Gemini 3 Stable', free: true, description: '稳定' },
      { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', free: true, description: '经典快速' },
      { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', free: true, description: '经典最强' },
    ],
  },
  // ─── SiliconFlow (硅基流动) ──
  // 来源: SiliconFlow 官方文档 + API 查询
  {
    id: 'siliconflow',
    name: 'SiliconFlow (硅基流动)',
    baseUrl: 'https://api.siliconflow.cn/v1',
    description: '国内高速访问，注册送免费额度',
    defaultModel: 'Qwen/Qwen3-235B-A22B',
    models: [
      {
        value: 'Qwen/Qwen3-235B-A22B',
        label: 'Qwen3 235B',
        free: true,
        description: '通义千问旗舰',
      },
      { value: 'Qwen/Qwen3-30B-A3B', label: 'Qwen3 30B', free: true, description: '轻量高效' },
      {
        value: 'Qwen/Qwen2.5-72B-Instruct',
        label: 'Qwen2.5 72B',
        free: true,
        description: '通义千问',
      },
      {
        value: 'Qwen/Qwen2.5-Coder-32B-Instruct',
        label: 'Qwen2.5 Coder 32B',
        free: true,
        description: '代码专用',
      },
      {
        value: 'deepseek-ai/DeepSeek-V3',
        label: 'DeepSeek V3',
        free: true,
        description: '深度求索',
      },
      {
        value: 'deepseek-ai/DeepSeek-R1',
        label: 'DeepSeek R1',
        free: true,
        description: '推理模型',
      },
      {
        value: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-32B',
        label: 'DeepSeek R1 蒸馏 32B',
        free: true,
      },
      {
        value: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-14B',
        label: 'DeepSeek R1 蒸馏 14B',
        free: true,
      },
      { value: 'meta-llama/Llama-3.3-70B-Instruct', label: 'Llama 3.3 70B', free: true },
      { value: 'meta-llama/Llama-3.1-8B-Instruct', label: 'Llama 3.1 8B', free: true },
      { value: 'THUDM/glm-4-9b-chat', label: 'GLM-4 9B', free: true, description: '智谱' },
      {
        value: 'internlm/internlm2_5-20b-chat',
        label: 'InternLM2.5 20B',
        free: true,
        description: '书生',
      },
      { value: '01-ai/Yi-1.5-34B-Chat', label: 'Yi 1.5 34B', free: true, description: '零一万物' },
    ],
  },
  // ─── Agnes (Sapiens AI) ──
  {
    id: 'agnes',
    name: 'Agnes (Sapiens AI)',
    baseUrl: 'https://api.agnes.dev/v1',
    description: 'Agnes AI 系列模型，专注代码智能',
    defaultModel: 'agnes-2.0-flash',
    models: [
      { value: 'agnes-2.0-flash', label: 'Agnes 2.0 Flash', free: true },
      { value: 'agnes-2.0-pro', label: 'Agnes 2.0 Pro' },
      { value: 'agnes-1.5', label: 'Agnes 1.5' },
    ],
  },
  // ─── OpenCode ──
  {
    id: 'opencode',
    name: 'OpenCode',
    baseUrl: 'https://api.opencode.ai/v1',
    description: 'OpenCode 开源模型平台',
    defaultModel: 'opencode-m1',
    models: [
      { value: 'opencode-m1', label: 'OpenCode M1', free: true },
      { value: 'opencode-m2', label: 'OpenCode M2' },
      { value: 'opencode-code-v1', label: 'OpenCode Code V1' },
      { value: 'deepseek/deepseek-v4-free', label: 'DeepSeek V4 (免费)', free: true },
      { value: 'deepseek/deepseek-v3-free', label: 'DeepSeek V3 (免费)', free: true },
      { value: 'deepseek/deepseek-r1-free', label: 'DeepSeek R1 (免费)', free: true },
      { value: 'mimo/mimo-v1-free', label: 'Mimo V1 (免费)', free: true },
      { value: 'mimo/mimo-v2-free', label: 'Mimo V2 (免费)', free: true },
    ],
  },
  // ─── OpenAI ──
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    description: 'GPT 系列模型',
    defaultModel: 'gpt-4.1-mini',
    models: [
      { value: 'gpt-4.1', label: 'GPT-4.1' },
      { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
      { value: 'gpt-4.1-nano', label: 'GPT-4.1 Nano' },
      { value: 'gpt-4o', label: 'GPT-4o' },
      { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
      { value: 'o4-mini', label: 'o4-mini' },
      { value: 'o3', label: 'o3' },
      { value: 'o3-mini', label: 'o3-mini' },
    ],
  },
  // ─── Anthropic ──
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    baseUrl: 'https://api.anthropic.com/v1',
    description: 'Claude 系列模型',
    defaultModel: 'claude-sonnet-4-20250514',
    models: [
      { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
      { value: 'claude-3-7-sonnet-20250219', label: 'Claude 3.7 Sonnet' },
      { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
      { value: 'claude-3-haiku-20240307', label: 'Claude 3 Haiku' },
    ],
  },
  // ─── 自定义 ──
  {
    id: 'custom',
    name: '自定义',
    baseUrl: '',
    description: '自定义 API 端点，支持任意 OpenAI 兼容模型',
    defaultModel: '',
    models: [],
  },
]

export interface AiMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  /** Internal: unique ID for execution placeholder messages */
  _execId?: string
  /** Internal: whether this message represents an executing command */
  _executing?: boolean
  /** Internal: cached exec result for analysis button */
  _execResult?: { command: string; stdout?: string; stderr?: string }
}

export type AiActionType = 'explain' | 'refactor' | 'fix' | 'optimize' | 'translate' | 'comment'

export interface AiActionRequest {
  type: AiActionType
  code: string
  language: string
  instruction?: string
}

export interface AiActionResponse {
  original: string
  modified: string
  explanation?: string
  diff?: string
}

export interface AiSuggestion {
  id: string
  title: string
  description: string
  code: string
  language: string
  timestamp: number
  applied: boolean
}
