import type {
  Attendance,
  AttachedImage,
  ClarifyField,
  ClarifyQuestion,
  DraftEvent,
  EventCategory,
} from '../types'
import { addDays, atTime, isoWithOffset, TIMEZONE } from './date'
import { buildClarifyQuestions } from './parser'

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
      "attendance": "required",
      "confidence": 0.93,
      "sourceExcerpt": "下周三下午3点到4点半，产品评审，3楼会议室",
      "warnings": [],
      "questions": [
        {
          "field": "location",
          "prompt": "活动地点是？",
          "options": [
            { "id": "room", "label": "3 楼会议室", "value": "3 楼会议室" },
            { "id": "online", "label": "线上", "value": "线上" },
            { "id": "pending", "label": "暂不确定", "value": "待定" }
          ],
          "allowCustom": true,
          "customPlaceholder": "输入地点"
        }
      ]
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
3. 只有日期没有时间时，allDay = true，start 为当天 00:00，end 为次日 00:00。
4. 相对日期以“当前时间”为锚点解析；“周五”指最近一个尚未过去的周五，“下周三”指下一周的周三。
5. 一段输入可以拆成多个事件。不要把不同事件合并。
6. 不确定、缺少年份、时间冲突或原文模糊时，在 warnings 里用一句中文说明，并降低 confidence。
7. category 只能是 work | life | health | focus | other。
8. attendance 只能是 required | optional | not_required | unknown。
9. confidence 是 0 到 1 之间的数字。
10. sourceExcerpt 必须逐字摘自原文；如果是图片，写你在图片中读到的对应短句。
11. 每个日程都必须有开始时间、结束时间和地点。无法从原文确定时，不要编造：把字段留空，并在 questions 里提问。
12. questions 最多 3 条，只在真正影响日程时提问：
    - 地点为空：给出原文线索 + “线上” + “暂不确定（value=待定）”；
    - 结束时间缺失或由模糊时长推测：给出 30/60/90/120 分钟对应的具体 ISO 时间；
    - 用户是否参加不明确：给出“需要参加 / 可选 / 不需要，仅记录”。
    每条 question 必须有 options，且 allowCustom=true；选项要具体、可点选。
13. end 时间必须晚于 start；全天日程 start 为当天 00:00，end 为次日 00:00。
14. 不要在 JSON 之外输出任何字符。`
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
const ALLOWED_FIELDS = new Set<ClarifyField>([
  'start',
  'end',
  'location',
  'attendance',
  'title',
  'other',
])

function normaliseQuestions(
  raw: unknown,
  start: string | null,
  end: string | null,
  location: string,
  segment: string,
  isEventLike: boolean,
): ClarifyQuestion[] {
  const fromModel: ClarifyQuestion[] = []
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue
      const item = entry as Record<string, unknown>
      const field = item.field
      if (typeof field !== 'string' || !ALLOWED_FIELDS.has(field as ClarifyField)) continue
      if (field === 'location' && location.trim()) continue
      if (field === 'end' && end) continue
      const options = Array.isArray(item.options)
        ? item.options
            .filter((option): option is Record<string, unknown> => Boolean(option && typeof option === 'object'))
            .map((option, index) => ({
              id:
                typeof option.id === 'string' && option.id.trim()
                  ? option.id
                  : `opt_${index}`,
              label:
                typeof option.label === 'string' && option.label.trim()
                  ? option.label
                  : `选项 ${index + 1}`,
              value: typeof option.value === 'string' ? option.value : undefined,
            }))
            .slice(0, 5)
        : []
      if (options.length === 0) continue
      fromModel.push({
        id: `q_${crypto.randomUUID()}`,
        field: field as ClarifyField,
        prompt:
          typeof item.prompt === 'string' && item.prompt.trim()
            ? item.prompt.trim()
            : '需要确认一下',
        options,
        allowCustom: item.allowCustom !== false,
        customPlaceholder:
          typeof item.customPlaceholder === 'string' ? item.customPlaceholder : '输入其他答案',
      })
    }
  }

  const fallback = buildClarifyQuestions(
    segment,
    start,
    Boolean(end),
    location,
    isEventLike,
  )
  const seen = new Set(fromModel.map((question) => question.field))
  for (const question of fallback) {
    if (!seen.has(question.field)) fromModel.push(question)
  }
  return fromModel.slice(0, 3)
}

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
  let end = normaliseEnd(start, item.end)
  if (start && allDay && !end) {
    end = isoWithOffset(atTime(addDays(new Date(start), 1), 0, 0))
  }
  const title = item.title.trim().slice(0, 120)
  const rawWarnings = Array.isArray(item.warnings)
    ? item.warnings.filter((warning): warning is string => typeof warning === 'string')
    : []
  const warnings = [...rawWarnings]
  if (!start) warnings.push('具体时间未定，先放入待安排')
  if (start && !end && !allDay) warnings.push('结束时间待确认')
  const location =
    typeof item.location === 'string' && item.location.trim()
      ? item.location.trim().slice(0, 120)
      : ''
  if (start && !location) warnings.push('地点待确认')
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
  const isEventLike = /会议|评审|活动|培训|聚会|婚礼|演出|面试|上课|约见|讨论/.test(
    `${title} ${excerpt}`,
  )
  const attendance: Attendance =
    item.attendance === 'required' ||
    item.attendance === 'optional' ||
    item.attendance === 'not_required'
      ? item.attendance
      : 'unknown'
  const questions = start
    ? normaliseQuestions(
        item.questions,
        start,
        end,
        location,
        `${title} ${excerpt}`,
        isEventLike,
      )
    : []
  const timestamp = new Date().toISOString()

  return {
    id: `evt_${crypto.randomUUID()}`,
    title,
    start,
    end,
    allDay,
    timezone: TIMEZONE,
    location,
    notes:
      typeof item.notes === 'string' && item.notes.trim()
        ? item.notes.trim().slice(0, 1000)
        : undefined,
    deadline:
      typeof item.deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.deadline)
        ? item.deadline
        : undefined,
    category,
    status:
      warnings.length > 0 || questions.length > 0 || confidence < 0.8
        ? 'tentative'
        : 'confirmed',
    attendance,
    source: { kind: sourceKind, excerpt },
    confidence: Number(confidence.toFixed(2)),
    warnings: Array.from(new Set(warnings)),
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    deviceId,
    rev: 1,
    selected: true,
    questions,
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
