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

/** 预设服务商列表 */
export const AI_PROVIDERS: AiProvider[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    description: '聚合多个模型，有免费额度',
    defaultModel: 'google/gemma-4-31b-it:free',
    models: [
      { value: 'google/gemma-4-31b-it:free', label: 'Gemma 4 31B (免费)', free: true },
      { value: 'google/gemma-4-26b-a4b-it:free', label: 'Gemma 4 26B A4B (免费)', free: true },
      { value: 'qwen/qwen3-coder:free', label: 'Qwen3 Coder 480B (免费)', free: true },
      { value: 'qwen/qwen3-next-80b-a3b-instruct:free', label: 'Qwen3 Next 80B (免费)', free: true },
      { value: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B (免费)', free: true },
      { value: 'nvidia/nemotron-3-super-120b-a12b:free', label: 'Nemotron 3 Super 120B (免费)', free: true },
      { value: 'nvidia/nemotron-3-ultra-550b-a55b:free', label: 'Nemotron 3 Ultra 550B (免费)', free: true },
      { value: 'openai/gpt-oss-20b:free', label: 'GPT-OSS 20B (免费)', free: true },
      { value: 'openai/gpt-oss-120b:free', label: 'GPT-OSS 120B (免费)', free: true },
      { value: 'mistralai/magistral-medium-2509', label: 'Magistral Medium 2509' },
    ],
  },
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
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    description: '官方 OpenAI API',
    defaultModel: 'gpt-4.1',
    models: [
      { value: 'gpt-4.1', label: 'GPT-4.1' },
      { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
      { value: 'gpt-4.1-nano', label: 'GPT-4.1 Nano' },
      { value: 'gpt-4o', label: 'GPT-4o' },
      { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
      { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
      { value: 'o3', label: 'O3' },
      { value: 'o3-mini', label: 'O3 Mini' },
      { value: 'o4-mini', label: 'O4 Mini' },
      { value: 'o4-mini-high', label: 'O4 Mini High' },
      { value: 'o1', label: 'O1' },
      { value: 'o1-mini', label: 'O1 Mini' },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    baseUrl: 'https://api.anthropic.com/v1',
    description: 'Claude 系列模型',
    defaultModel: 'claude-sonnet-4-20250514',
    models: [
      { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
      { value: 'claude-4-6-sonnet-20260514', label: 'Claude 4.6 Sonnet' },
      { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
      { value: 'claude-3-7-sonnet-20250219', label: 'Claude 3.7 Sonnet' },
      { value: 'claude-3-haiku-20240307', label: 'Claude 3 Haiku' },
    ],
  },
  {
    id: 'google',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    description: 'Gemini 系列模型',
    defaultModel: 'gemini-2.5-flash',
    models: [
      { value: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
      { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
      { value: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite' },
      { value: 'gemma-4-27b-it', label: 'Gemma 4 27B (Google 官方)' },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    description: 'DeepSeek 系列模型',
    defaultModel: 'deepseek-chat-v4',
    models: [
      { value: 'deepseek-chat-v4', label: 'DeepSeek V4', description: '最新旗舰版' },
      { value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', description: 'V4 快速版' },
      { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', description: 'V4 增强版' },
      { value: 'deepseek-chat', label: 'DeepSeek V3', description: 'DeepSeek V3' },
      { value: 'deepseek-v3-2', label: 'DeepSeek V3.2', description: 'V3.2 迭代版' },
      { value: 'deepseek-v3-2-exp', label: 'DeepSeek V3.2 Exp', description: 'V3.2 实验版' },
      { value: 'deepseek-reasoner', label: 'DeepSeek R1', description: '推理增强版' },
      { value: 'deepseek-r1-0528', label: 'DeepSeek R1 0528', description: 'R1 最新版' },
      { value: 'deepseek-reasoner-latest', label: 'DeepSeek R1 (Latest)', description: 'R1 最新稳定版' },
    ],
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow (硅基流动)',
    baseUrl: 'https://api.siliconflow.cn/v1',
    description: '国内高速访问，多种开源模型',
    defaultModel: 'deepseek-ai/DeepSeek-V4-Flash',
    models: [
      { value: 'deepseek-ai/DeepSeek-V4-Flash', label: 'DeepSeek V4 Flash', description: '最新' },
      { value: 'deepseek-ai/DeepSeek-V4-Pro', label: 'DeepSeek V4 Pro', description: '最强' },
      { value: 'deepseek-ai/DeepSeek-V3', label: 'DeepSeek V3', description: 'DeepSeek' },
      { value: 'Qwen/Qwen3-235B-A22B', label: 'Qwen 3 235B A22B', description: '通义千问旗舰' },
      { value: 'Qwen/Qwen2.5-72B-Instruct', label: 'Qwen 2.5 72B', description: '通义千问' },
      { value: 'Qwen/Qwen2.5-32B-Instruct', label: 'Qwen 2.5 32B', description: '通义千问' },
      { value: 'meta-llama/Llama-4-Scout-17B-16E', label: 'Llama 4 Scout 17B', description: 'Meta' },
      { value: 'meta-llama/Llama-3.3-70B-Instruct', label: 'Llama 3.3 70B', description: 'Meta' },
      { value: 'Pro/Qwen3-235B-A22B-Turbo', label: 'Qwen 3 235B Turbo', description: '通义千问旗舰加速' },
    ],
  },
  {
    id: 'custom',
    name: '自定义',
    baseUrl: '',
    description: '自定义 API 端点，支持任意模型',
    defaultModel: '',
    models: [],
  },
]

export interface AiMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
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
