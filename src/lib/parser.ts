import type {
  Attendance,
  ClarifyQuestion,
  DraftEvent,
  EventCategory,
} from '../types'
import {
  addDays,
  atTime,
  dateKey,
  endOfMonth,
  formatTime,
  isoWithOffset,
  startOfDay,
  startOfWeek,
  TIMEZONE,
} from './date'

const NUM = '[0-9一二三四五六七八九十]{1,3}'
const CN_DIGITS: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
}

interface DateMatch {
  date: Date | null
  matched: string
  deadline?: string
  warning?: string
}

interface TimeMatch {
  startMinutes: number
  endMinutes: number
  matched: string
  /** True when the source stated an end time or a duration. */
  endExplicit: boolean
}

interface DurationMatch {
  minutes: number
  matched: string
}

function cnNumber(value: string): number {
  if (/^\d+$/.test(value)) return Number(value)
  if (value === '十') return 10
  if (value.includes('十')) {
    const [tens, ones] = value.split('十')
    return (tens ? (CN_DIGITS[tens] ?? 1) : 1) * 10 + (ones ? (CN_DIGITS[ones] ?? 0) : 0)
  }
  return CN_DIGITS[value] ?? Number.NaN
}

function validDate(year: number, month: number, day: number, hour = 0, minute = 0): Date | null {
  const date = new Date(year, month - 1, day, hour, minute, 0, 0)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }
  return date
}

function parseDateToken(segment: string, now: Date): DateMatch | null {
  const full = segment.match(
    new RegExp(`(\\d{4})\\s*年\\s*(${NUM})\\s*月\\s*(${NUM})\\s*[日号]?`),
  )
  if (full) {
    const date = validDate(Number(full[1]), cnNumber(full[2]), cnNumber(full[3]))
    if (date) return { date, matched: full[0] }
  }

  const monthDay = segment.match(new RegExp(`(${NUM})\\s*月\\s*(${NUM})\\s*[日号]?`))
  if (monthDay) {
    const month = cnNumber(monthDay[1])
    const day = cnNumber(monthDay[2])
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      let year = now.getFullYear()
      const candidate = validDate(year, month, day)
      if (candidate && candidate < startOfDay(now) && month < now.getMonth() + 1) {
        year += 1
      }
      const date = validDate(year, month, day)
      if (date) {
        return {
          date,
          matched: monthDay[0],
          warning: /\d{4}\s*年/.test(segment) ? undefined : '原文没有年份，已按最近的日期补全',
        }
      }
    }
  }

  const nextMonthDay = segment.match(
    new RegExp(`下个?月\\s*(${NUM})\\s*[日号]`),
  )
  if (nextMonthDay) {
    const monthIndex = now.getMonth() + 1
    const date = validDate(now.getFullYear(), monthIndex + 1, cnNumber(nextMonthDay[1]))
    if (date) return { date, matched: nextMonthDay[0] }
  }

  const slash = segment.match(/(?<![\d:])(\d{1,2})\/(\d{1,2})(?![\d:])/)
  if (slash) {
    const month = Number(slash[1])
    const day = Number(slash[2])
    let year = now.getFullYear()
    let date = validDate(year, month, day)
    if (date && date < startOfDay(now) && month < now.getMonth() + 1) {
      year += 1
      date = validDate(year, month, day)
    }
    if (date) return { date, matched: slash[0], warning: '日期没有写年份，已自动补全' }
  }

  const relative = segment.match(/大后天|后天|明天|明日|今天|今日|今晚|明晚|后晚/)
  if (relative) {
    const token = relative[0]
    let offset = 0
    if (token === '后天' || token === '后晚') offset = 2
    if (token === '大后天') offset = 3
    if (token === '明天' || token === '明日' || token === '明晚') offset = 1
    return { date: addDays(startOfDay(now), offset), matched: token }
  }

  const deadline = segment.match(/(下个?月|本)?\s*月底(?:前|之前)?|(下个?月|本月)底(?:前|之前)?/)
  if (deadline) {
    const isNext = /下个?月/.test(deadline[0])
    const monthDate = new Date(now.getFullYear(), now.getMonth() + (isNext ? 1 : 0), 1)
    return {
      date: null,
      matched: deadline[0],
      deadline: dateKey(endOfMonth(monthDate)),
      warning: '只识别到截止时间，具体安排还未确定',
    }
  }

  const weekday = segment.match(
    /(下下|下个|下|本|这|上)?\s*(?:周|星期|礼拜)\s*([一二三四五六日天])/,
  )
  if (weekday) {
    const prefix = weekday[1] ?? ''
    const weekdayMap: Record<string, number> = {
      一: 1,
      二: 2,
      三: 3,
      四: 4,
      五: 5,
      六: 6,
      日: 0,
      天: 0,
    }
    const target = weekdayMap[weekday[2]]
    const mondayIndex = (target + 6) % 7
    let base = startOfWeek(now)
    if (prefix === '下' || prefix === '下个') base = addDays(base, 7)
    if (prefix === '下下') base = addDays(base, 14)
    if (prefix === '上') base = addDays(base, -7)
    let date = addDays(base, mondayIndex)
    if (!prefix && date < startOfDay(now)) date = addDays(date, 7)
    return { date, matched: weekday[0] }
  }

  const bareDay = segment.match(new RegExp(`(?:^|[，,；;\\s])(${NUM})\\s*[日号]`))
  if (bareDay) {
    const day = cnNumber(bareDay[1])
    let date = validDate(now.getFullYear(), now.getMonth() + 1, day)
    if (date && date < startOfDay(now)) {
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)
      date = validDate(nextMonth.getFullYear(), nextMonth.getMonth() + 1, day)
    }
    if (date) return { date, matched: bareDay[0].replace(/^[，,；;\s]/, '') }
  }

  return null
}

function to24Hour(hour: number, meridiem: string | undefined, eveningContext: boolean): number {
  if (meridiem) {
    if (/下午|傍晚|晚上/.test(meridiem) && hour < 12) return hour + 12
    if (/中午/.test(meridiem) && hour < 11) return hour + 12
    if (/凌晨/.test(meridiem) && hour === 12) return 0
    return hour
  }
  if (eveningContext && hour < 12) return hour + 12
  return hour
}

function minuteFromToken(token: string | undefined): number {
  if (!token) return 0
  if (token === '半') return 30
  if (token === '一刻') return 15
  if (token === '三刻') return 45
  const numeric = token.match(/(\d{1,2}|[一二三四五六七八九十]{1,3})\s*分/)
  if (numeric) return cnNumber(numeric[1])
  return 0
}

function parseTime(segment: string, eveningContext: boolean): TimeMatch | null {
  const colon = segment.match(
    /(上午|下午|晚上|傍晚|早上|早晨|中午|凌晨)?\s*(\d{1,2})\s*[:：]\s*(\d{2})\s*(?:-|–|—|~|～|到|至)\s*(上午|下午|晚上|傍晚|早上|早晨|中午|凌晨)?\s*(\d{1,2})\s*(?:[:：]\s*(\d{2}))?/,
  )
  if (colon) {
    const start = to24Hour(Number(colon[2]), colon[1], eveningContext)
    let end = to24Hour(Number(colon[5]), colon[4] || colon[1], eveningContext)
    if (end <= start) end += 12
    return {
      startMinutes: start * 60 + Number(colon[3]),
      endMinutes: end * 60 + Number(colon[6] ?? 0),
      matched: colon[0],
      endExplicit: true,
    }
  }

  const range = segment.match(
    new RegExp(
      `(上午|下午|晚上|傍晚|早上|早晨|中午|凌晨)?\\s*(${NUM})\\s*[点时]\\s*(半|一刻|三刻|(?:${NUM})\\s*分)?\\s*(?:到|至|-|–|—|~|～)\\s*(上午|下午|晚上|傍晚|早上|早晨|中午|凌晨)?\\s*(${NUM})\\s*[点时]\\s*(半|一刻|三刻|(?:${NUM})\\s*分)?`,
    ),
  )
  if (range) {
    const start = to24Hour(cnNumber(range[2]), range[1], eveningContext)
    let end = to24Hour(cnNumber(range[5]), range[4] || range[1], eveningContext)
    if (end <= start) end += 12
    return {
      startMinutes: start * 60 + minuteFromToken(range[3]),
      endMinutes: end * 60 + minuteFromToken(range[6]),
      matched: range[0],
      endExplicit: true,
    }
  }

  const single = segment.match(
    new RegExp(
      `(上午|下午|晚上|傍晚|早上|早晨|中午|凌晨)?\\s*(${NUM})\\s*[点时]\\s*(半|一刻|三刻|(?:${NUM})\\s*分)?`,
    ),
  )
  if (single) {
    const hour = to24Hour(cnNumber(single[2]), single[1], eveningContext)
    if (!Number.isFinite(hour) || hour > 23) return null
    const minutes = hour * 60 + minuteFromToken(single[3])
    return {
      startMinutes: minutes,
      endMinutes: minutes + 60,
      matched: single[0],
      endExplicit: false,
    }
  }

  const colonSingle = segment.match(
    /(上午|下午|晚上|傍晚|早上|早晨|中午|凌晨)?\s*(\d{1,2})\s*[:：]\s*(\d{2})/,
  )
  if (colonSingle) {
    const hour = to24Hour(Number(colonSingle[2]), colonSingle[1], eveningContext)
    if (hour > 23) return null
    const minutes = hour * 60 + Number(colonSingle[3])
    return {
      startMinutes: minutes,
      endMinutes: minutes + 60,
      matched: colonSingle[0],
      endExplicit: false,
    }
  }

  return null
}

function parseDuration(segment: string): DurationMatch | null {
  const prefix = '(?:大概|大约|约)?\\s*'
  const oneHalf = segment.match(
    new RegExp(`${prefix}(?:一个?半|1\\.5|一又二分之一)\\s*个?\\s*小时`),
  )
  if (oneHalf) return { minutes: 90, matched: oneHalf[0] }
  const half = segment.match(new RegExp(`${prefix}半\\s*个?\\s*小时`))
  if (half) return { minutes: 30, matched: half[0] }
  const hours = segment.match(new RegExp(`${prefix}(${NUM})\\s*个?\\s*小时`))
  if (hours) {
    const value = cnNumber(hours[1])
    if (Number.isFinite(value)) return { minutes: value * 60, matched: hours[0] }
  }
  const minutes = segment.match(new RegExp(`${prefix}(${NUM})\\s*分钟`))
  if (minutes) {
    const value = cnNumber(minutes[1])
    if (Number.isFinite(value)) return { minutes: value, matched: minutes[0] }
  }
  return null
}

function strip(segment: string, token: string | undefined): string {
  return token ? segment.replace(token, '') : segment
}

function categoryOf(text: string): EventCategory {
  if (/评审|周会|汇报|项目|客户|面试|需求|上线|复盘|会议|设计|工作|加班|日报|周报/.test(text)) {
    return 'work'
  }
  if (/医院|牙医|体检|健身|跑步|复诊|吃药|就诊|看诊|睡眠/.test(text)) return 'health'
  if (/阅读|写作|学习|课程|专注|冥想|练习|读书/.test(text)) return 'focus'
  if (/吃饭|聚餐|电影|生日|朋友|咖啡|旅行|约会|逛街|演出|展览|演唱会/.test(text)) {
    return 'life'
  }
  return 'other'
}

function cleanTitle(segment: string, removed: string[]): string {
  let text = segment
  for (const token of removed) text = strip(text, token)
  text = text.replace(/\s+/g, ' ').trim()
  text = text.replace(/([\u4e00-\u9fa5])\s+(?=[\u4e00-\u9fa5])/g, '$1')
  text = text.replace(/^(?:还有|另外|以及|然后|提醒我?|帮我|请|记得|安排|需要|要)\s*/g, '')
  text = text.replace(/^(?:还有|另外|提醒我?|帮我|记得)\s*/g, '')
  text = text.replace(/(?:具体时间)?(?:还)?没定|时间待定|再约|待定/g, '')
  text = text.replace(/^(?:大概|大约|约)\s*|(?:大概|大约|约)$/g, '')
  text = text.replace(/^[，,、；;：:\s]+|[，,、；;：:\s]+$/g, '')
  text = text.replace(/^把/, '')
  return text.trim()
}

function extractLocation(text: string): { location?: string; text: string } {
  const paren = text.match(/[（(]\s*([^）)]{2,30})\s*[）)]/)
  if (paren && /线上|会议|室|楼|厅|馆|店|中心|咖啡|餐厅|腾讯|飞书|Zoom/i.test(paren[1])) {
    return {
      location: paren[1].trim(),
      text: text.replace(paren[0], ' '),
    }
  }

  const inPlace = text.match(
    /(?:在|@)\s*([^，,。；;]{2,30}?)(?=(?:吃饭|见面|开会|集合|碰面|见|上课|上班|就诊|看诊|看电影|喝咖啡|聊|讨论|谈|喝|吃|看|逛|买|办|参加|面试|办公|工作|$))/,
  )
  if (inPlace) {
    return {
      location: inPlace[1].trim(),
      text: text.replace(inPlace[0], ' '),
    }
  }

  const trailing = text.match(
    /[，,]\s*([^，,。；;]{1,36}?(?:楼|层|室|厅|馆|店|中心|大厦|公园|咖啡|餐厅|会议室))\s*$/,
  )
  if (trailing) {
    return {
      location: trailing[1].trim(),
      text: text.replace(trailing[0], ''),
    }
  }

  const labeled = text.match(/(?:地点|地址)\s*[:：]\s*([^，,。；;]+)/)
  if (labeled) {
    return {
      location: labeled[1].trim(),
      text: text.replace(labeled[0], ' '),
    }
  }

  return { text }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `evt_${crypto.randomUUID()}`
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function questionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `q_${crypto.randomUUID()}`
  return `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/** Questions are intentionally short and always include a free-text option. */
export function buildClarifyQuestions(
  segment: string,
  start: string | null,
  endExplicit: boolean,
  location: string,
  isEventLike: boolean,
): ClarifyQuestion[] {
  const questions: ClarifyQuestion[] = []

  if (!location.trim()) {
    questions.push({
      id: questionId(),
      field: 'location',
      prompt: '地点还没有确定，在哪里？',
      options: [
        { id: 'online', label: '线上', value: '线上' },
        { id: 'pending', label: '暂不确定', value: '待定' },
      ],
      allowCustom: true,
      customPlaceholder: '输入地点，例如：3 楼会议室',
    })
  }

  if (start && !endExplicit) {
    const startDate = new Date(start)
    const endOption = (minutes: number): { id: string; label: string; value: string } => {
      const endDate = new Date(startDate.getTime() + minutes * 60_000)
      return {
        id: `end_${minutes}`,
        label: `${minutes < 60 ? `${minutes} 分钟` : `${minutes / 60} 小时`}（${formatTime(
          isoWithOffset(endDate),
        )} 结束）`,
        value: isoWithOffset(endDate),
      }
    }
    questions.push({
      id: questionId(),
      field: 'end',
      prompt: '预计什么时候结束？',
      options: [endOption(30), endOption(60), endOption(90), endOption(120)],
      allowCustom: true,
      customPlaceholder: '输入结束时间，例如：16:30 或 1.5 小时',
    })
  }

  const attendanceStated = /(?:我|本人).{0,6}(?:参加|出席|去|不去|不参加|无法参加)/.test(segment)
  if (isEventLike && !attendanceStated) {
    questions.push({
      id: questionId(),
      field: 'attendance',
      prompt: '这个活动你需要参加吗？',
      options: [
        { id: 'required', label: '需要参加', value: 'required' },
        { id: 'optional', label: '可选，先留着', value: 'optional' },
        { id: 'not_required', label: '不需要，仅记录', value: 'not_required' },
      ],
      allowCustom: true,
      customPlaceholder: '输入你的安排，例如：只参加前半段',
    })
  }

  return questions
}

function parseSegment(
  raw: string,
  now: Date,
  deviceId: string,
): DraftEvent | null {
  const segment = raw
    .replace(/\u3000/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim()
    .replace(/[。；;，,、\s]+$/g, '')
  if (!segment || segment.length < 2) return null

  const dateMatch = parseDateToken(segment, now)
  const eveningContext = /今晚|明晚|后晚|夜里|晚间/.test(segment)
  const timeMatch = parseTime(segment, eveningContext)
  const durationMatch = parseDuration(segment)
  const hasTaskCue = /提醒|记得|待办|别忘|截止|提交|交材料|续签|缴费|预约/.test(segment)

  if (!dateMatch && !timeMatch && !hasTaskCue) return null

  const warnings: string[] = []
  let startDate: Date | null = dateMatch?.date ?? null
  let deadline = dateMatch?.deadline
  let allDay = false
  let startMinutes: number | null = null
  let endMinutes: number | null = null

  if (!startDate && !deadline) {
    startDate = startOfDay(now)
    warnings.push('原文没有日期，先按今天处理')
  }

  if (timeMatch) {
    startMinutes = timeMatch.startMinutes
    endMinutes = timeMatch.endMinutes
    if (!startDate) startDate = startOfDay(now)
  } else if (startDate) {
    allDay = true
    warnings.push('没有写具体时间，按全天日程处理')
  } else {
    warnings.push('具体时间未定，放入待安排')
  }

  if (dateMatch?.warning) warnings.push(dateMatch.warning)
  if (startDate && startDate < startOfDay(now)) warnings.push('这个日期已经过去，请确认')
  if (durationMatch && !timeMatch) {
    warnings.push('只识别到时长，开始时间仍需确认')
  }
  if (durationMatch && timeMatch) {
    endMinutes = Math.max(endMinutes ?? 0, startMinutes! + durationMatch.minutes)
  }

  const removed = [
    dateMatch?.matched,
    timeMatch?.matched,
    durationMatch?.matched,
  ].filter((value): value is string => Boolean(value))
  let title = cleanTitle(segment, removed)
  const extracted = extractLocation(title)
  const location = extracted.location ?? ''
  title = cleanTitle(extracted.text, [])
  if (!title) title = '未命名日程'
  if (title.length > 60) title = `${title.slice(0, 58)}…`

  const category = categoryOf(`${title} ${segment}`)
  const hasDate = Boolean(dateMatch?.date || deadline)
  const hasTime = Boolean(timeMatch)
  let confidence = 0.5
  if (hasDate) confidence += 0.2
  if (hasTime) confidence += 0.18
  if (location) confidence += 0.04
  if (title && title !== '未命名日程') confidence += 0.06
  if (!hasDate) confidence -= 0.08
  confidence = clamp(Number(confidence.toFixed(2)), 0.35, 0.98)

  let start: string | null = null
  let end: string | null = null
  if (startDate && startMinutes !== null) {
    const begin = atTime(startDate, Math.floor(startMinutes / 60), startMinutes % 60)
    const finish = atTime(
      startDate,
      Math.floor((endMinutes ?? startMinutes + 60) / 60),
      (endMinutes ?? startMinutes + 60) % 60,
    )
    start = isoWithOffset(begin)
    end = isoWithOffset(finish)
  } else if (startDate && allDay) {
    start = isoWithOffset(atTime(startDate, 0, 0))
    // An all-day event still has an explicit boundary; this keeps the data
    // model consistent and lets week view render it without a special case.
    end = isoWithOffset(atTime(addDays(startDate, 1), 0, 0))
  }

  const isEventLike = /会议|评审|活动|培训|聚会|婚礼|演出|面试|上课|约见|讨论/.test(segment)
  const attendance: Attendance = /不参加|不去|无法参加/.test(segment)
    ? 'not_required'
    : /(?:我|本人).{0,6}(?:参加|出席|去)/.test(segment)
      ? 'required'
      : 'unknown'
  const questions = start
    ? buildClarifyQuestions(
        segment,
        start,
        allDay || Boolean(timeMatch?.endExplicit || durationMatch),
        location,
        isEventLike,
      )
    : []
  if (!location.trim() && start) warnings.push('地点待确认')

  const excerpt = segment.length > 95 ? `${segment.slice(0, 93)}…` : segment
  const timestamp = new Date().toISOString()

  return {
    id: makeId(),
    title,
    start,
    end,
    allDay,
    timezone: TIMEZONE,
    location,
    notes: undefined,
    deadline,
    category,
    status:
      warnings.length > 0 || questions.length > 0 || confidence < 0.8
        ? 'tentative'
        : 'confirmed',
    attendance,
    source: { kind: 'text', excerpt },
    confidence,
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

/**
 * Offline demo parser. This is deliberately rule-based: it handles the
 * concrete, unambiguous shapes of a line of Chinese scheduling text and
 * leaves everything else to the user for review. AI parsing is the primary
 * path in the product; this exists so the demo works with no API key.
 */
export function parseScheduleText(
  text: string,
  now: Date,
  deviceId: string,
): DraftEvent[] {
  const segments = text
    .split(/\n+|(?<=[。；;])/)
    .map((part) => part.trim())
    .filter(Boolean)

  const drafts: DraftEvent[] = []
  for (const segment of segments) {
    const draft = parseSegment(segment, now, deviceId)
    if (draft) drafts.push(draft)
  }

  // A line that did not contain a date but did contain several sentences may
  // still be one event. If nothing was found, retry the whole input once.
  if (drafts.length === 0) {
    const draft = parseSegment(text, now, deviceId)
    if (draft) drafts.push(draft)
  }

  return drafts
}
