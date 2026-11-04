export interface ProviderPreset {
  id: string
  name: string
  baseUrl: string
  note?: string
}

/**
 * Official OpenAI-compatible endpoints. Anthropic's Messages API is not
 * included because it is not OpenAI Chat Completions-compatible; the product
 * decision for v0.3 is to ship DeepSeek as the default and keep this list to
 * providers that work with the existing engine.
 */
export const PROVIDERS: ProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek 深度求索',
    baseUrl: 'https://api.deepseek.com/v1',
    note: '默认；deepseek-chat 支持文本，视觉能力取决于账号可用模型。',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    note: '支持 GPT 系列；图片走视觉模型。',
  },
  {
    id: 'qwen',
    name: '通义千问 / DashScope',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    note: '阿里云百炼 OpenAI 兼容模式。',
  },
  {
    id: 'moonshot',
    name: 'Moonshot 月之暗面',
    baseUrl: 'https://api.moonshot.cn/v1',
    note: 'Kimi 系列。',
  },
  {
    id: 'zhipu',
    name: '智谱 BigModel',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    note: 'GLM 系列。',
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow 硅基流动',
    baseUrl: 'https://api.siliconflow.cn/v1',
    note: '聚合多家开源模型。',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    note: '聚合接口；模型名通常带厂商前缀。',
  },
  {
    id: 'gemini',
    name: 'Google Gemini（OpenAI 兼容）',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    note: '使用 Gemini 的 OpenAI 兼容层。',
  },
  {
    id: 'ollama',
    name: 'Ollama（本地）',
    baseUrl: 'http://localhost:11434/v1',
    note: '本机模型；Key 可留空或填 ollama。',
  },
]

export function findProviderByBaseUrl(baseUrl: string): ProviderPreset | undefined {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  return PROVIDERS.find((provider) => provider.baseUrl.replace(/\/+$/, '') === normalized)
}

function modelsEndpoint(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  if (base.endsWith('/chat/completions')) return `${base.slice(0, -'/chat/completions'.length)}/models`
  if (base.endsWith('/models')) return base
  return `${base}/models`
}

export interface ModelInfo {
  id: string
  ownedBy?: string
}

/** Fetch the model catalog from an OpenAI-compatible endpoint. */
export async function fetchModels(baseUrl: string, apiKey: string): Promise<ModelInfo[]> {
  const url = modelsEndpoint(baseUrl)
  if (!/^https?:\/\//i.test(url)) throw new Error('接口地址需要以 http:// 或 https:// 开头')
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        ...(apiKey.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {}),
      },
      signal: controller.signal,
    })
    if (!response.ok) {
      let detail = `${response.status} ${response.statusText}`
      try {
        const payload = (await response.json()) as { error?: { message?: string } }
        if (payload.error?.message) detail = payload.error.message
      } catch {
        // Gateways sometimes return HTML; status is still useful.
      }
      throw new Error(`获取模型失败：${detail}`)
    }
    const payload = (await response.json()) as {
      data?: Array<{ id?: string; owned_by?: string }>
      models?: Array<{ name?: string; id?: string }>
    }
    const list: ModelInfo[] = []
    for (const item of payload.data ?? []) {
      if (typeof item.id === 'string' && item.id.trim()) {
        list.push({ id: item.id.trim(), ownedBy: item.owned_by })
      }
    }
    for (const item of payload.models ?? []) {
      const id = typeof item.id === 'string' ? item.id : item.name
      if (typeof id === 'string' && id.trim()) list.push({ id: id.trim() })
    }
    const deduped = Array.from(new Map(list.map((item) => [item.id, item])).values())
    if (deduped.length === 0) throw new Error('接口返回成功，但没有找到模型列表')
    return deduped.sort((a, b) => a.id.localeCompare(b.id))
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('获取模型超时，请检查接口地址或稍后重试')
    }
    if (error instanceof TypeError) {
      throw new Error('无法连接模型接口：可能是地址错误、网络问题或浏览器跨域限制')
    }
    throw error
  } finally {
    window.clearTimeout(timer)
  }
}
