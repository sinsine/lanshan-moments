import type { AttachedImage, DraftEvent, EventCategory } from '../types'
import { atTime, isoWithOffset, TIMEZONE } from './date'

export interface AiConfig {
  baseUrl: string
  model: string
  apiKey: string
}

const SCHEMA_EXAMPLE = `{
  "events": [
    {
      "title": "产品评审",
      "start": "2026-11-11T15:00:00+08:00",
      "end": "2026-11-11T16:30:00+08:00",
      "allDay": false,
      "location": "3 楼会议室",
      "notes": "",
      "deadline": null,
      "category": "work",
      "confidence": 0.93,
      "sourceExcerpt": "下周三下午3点到4点半，产品评审，3楼会议室",
      "warnings": []
    }
  ]
}`

function systemPrompt(now: Date): string {
  return `你是「阑珊时刻」的日程整理引擎。你的任务只有一件事：把用户给出的时间信息，整理成可直接写入时间轴的 JSON。

当前时间：${now.toLocaleString('zh-CN', { hour12: false })}（时区 ${TIMEZONE}，${now.toISOString()}）
今天：${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}

必须严格输出一个 JSON 对象，不要 Markdown，不要解释。结构：
${SCHEMA_EXAMPLE}

规则：
1. 只输出用户明确提供的信息，不编造人物、地点、时长或日期。
2. start / end 使用带时区偏移的 ISO 8601。无法确定具体时间时 start 为 null，并放进待安排。
3. 只有日期没有时间时，allDay = true，start 设为当天 00:00，end 为 null。
4. 相对日期以“当前时间”为锚点解析；“周五”指最近一个尚未过去的周五，“下周三”指下一周的周三。
5. 一段输入可以拆成多个事件。不要把不同事件合并。
6. 不确定、缺少年份、时间冲突或原文模糊时，在 warnings 里用一句中文说明，并降低 confidence。
7. category 只能是 work | life | health | focus | other。
8. confidence 是 0 到 1 之间的数字。
9. sourceExcerpt 必须逐字摘自原文；如果是图片，写你在图片中读到的对应短句。
10. 不要在 JSON 之外输出任何字符。`
}

async function requestCompletion(
  config: AiConfig,
  body: Record<string, unknown>,
): Promise<string> {
  const base = config.baseUrl.replace(/\/+$/, '')
  const endpoint = /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 60_000)
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!response.ok) {
      let detail = `${response.status} ${response.statusText}`
      try {
        const payload = (await response.json()) as { error?: { message?: string } }
        if (payload.error?.message) detail = payload.error.message
      } catch {
        // Some gateways return HTML errors; the status is still useful.
      }
      throw new Error(detail)
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>
    }
    const content = payload.choices?.[0]?.message?.content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content.map((part) => part.text ?? '').join('')
    }
    throw new Error('模型没有返回内容')
  } finally {
    window.clearTimeout(timer)
  }
}

function parseJsonObject(raw: string): unknown {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  try {
    return JSON.parse(cleaned)
  } catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1))
    throw new Error('模型返回的内容不是合法 JSON')
  }
}

function normaliseStart(value: unknown, allDay: boolean): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number)
    return isoWithOffset(atTime(new Date(year, month - 1, day), 0, 0))
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  if (allDay) return isoWithOffset(atTime(date, 0, 0))
  return isoWithOffset(date)
}

function normaliseEnd(start: string | null, value: unknown): string | null {
  if (!start || typeof value !== 'string' || !value.trim()) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const startDate = new Date(start)
  if (date <= startDate) return null
  return isoWithOffset(date)
}

const ALLOWED_CATEGORIES = new Set<EventCategory>(['work', 'life', 'health', 'focus', 'other'])

function normaliseEvent(
  raw: unknown,
  sourceExcerpt: string,
  deviceId: string,
  sourceKind: 'text' | 'image',
): DraftEvent | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  if (typeof item.title !== 'string' || !item.title.trim()) return null

  const allDay = Boolean(item.allDay)
  const start = normaliseStart(item.start, allDay)
  const end = normaliseEnd(start, item.end)
  const rawWarnings = Array.isArray(item.warnings)
    ? item.warnings.filter((warning): warning is string => typeof warning === 'string')
    : []
  const warnings = [...rawWarnings]
  if (!start) warnings.push('具体时间未定，先放入待安排')
  if (start && allDay) warnings.push('全天日程，没有具体钟点')
  const category =
    typeof item.category === 'string' && ALLOWED_CATEGORIES.has(item.category as EventCategory)
      ? (item.category as EventCategory)
      : 'other'
  const confidenceRaw = typeof item.confidence === 'number' ? item.confidence : 0.7
  const confidence = Math.min(1, Math.max(0, confidenceRaw))
  const excerpt =
    typeof item.sourceExcerpt === 'string' && item.sourceExcerpt.trim()
      ? item.sourceExcerpt.trim().slice(0, 160)
      : sourceExcerpt
  const timestamp = new Date().toISOString()

  return {
    id: `evt_${crypto.randomUUID()}`,
    title: item.title.trim().slice(0, 120),
    start,
    end,
    allDay,
    timezone: TIMEZONE,
    location:
      typeof item.location === 'string' && item.location.trim()
        ? item.location.trim().slice(0, 120)
        : undefined,
    notes:
      typeof item.notes === 'string' && item.notes.trim()
        ? item.notes.trim().slice(0, 1000)
        : undefined,
    deadline:
      typeof item.deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.deadline)
        ? item.deadline
        : undefined,
    category,
    status: warnings.length > 0 || confidence < 0.8 ? 'tentative' : 'confirmed',
    source: { kind: sourceKind, excerpt },
    confidence: Number(confidence.toFixed(2)),
    warnings: Array.from(new Set(warnings)),
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    deviceId,
    rev: 1,
    selected: true,
  }
}

export async function parseWithAi(
  text: string,
  image: AttachedImage | null,
  config: AiConfig,
  deviceId: string,
  now = new Date(),
): Promise<{ drafts: DraftEvent[]; model: string }> {
  const userText =
    text.trim() ||
    (image ? '请读取这张图片里的全部时间安排，并整理成日程。' : '')
  if (!userText) throw new Error('没有可解析的内容')

  const content: Array<Record<string, unknown>> = [{ type: 'text', text: userText }]
  if (image) {
    content.push({ type: 'image_url', image_url: { url: image.dataUrl } })
  }

  const body: Record<string, unknown> = {
    model: config.model,
    temperature: 0.1,
    max_tokens: 2200,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt(now) },
      { role: 'user', content: image ? content : userText },
    ],
  }

  let raw: string
  try {
    raw = await requestCompletion(config, body)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // Some OpenAI-compatible gateways reject response_format. Retry once
    // without it instead of failing the whole import.
    if (/response_format|json_object|400|422|unsupported/i.test(message)) {
      delete body.response_format
      raw = await requestCompletion(config, body)
    } else {
      throw error
    }
  }

  const parsed = parseJsonObject(raw) as { events?: unknown[] }
  if (!Array.isArray(parsed.events)) throw new Error('模型没有返回 events 数组')

  const drafts = parsed.events
    .map((event) =>
      normaliseEvent(event, userText.slice(0, 160), deviceId, image ? 'image' : 'text'),
    )
    .filter((event): event is DraftEvent => Boolean(event))

  if (drafts.length === 0) throw new Error('模型没有识别出任何日程')
  return { drafts, model: config.model }
}

export function friendlyAiError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return '请求超时了，请检查网络或稍后重试'
  }
  if (error instanceof TypeError) {
    return '无法连接模型接口。若在浏览器中运行，可能是该接口不允许跨域（CORS），可改用桌面端或自己的代理'
  }
  if (error instanceof Error) return error.message
  return '调用模型时发生未知错误'
}
