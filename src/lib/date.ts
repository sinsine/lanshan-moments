export const TIMEZONE =
  Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'

const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六']

export function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0')
}

export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function parseDateKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function addDays(date: Date, amount: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + amount)
  return next
}

export function startOfDay(date: Date): Date {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

/** Monday-first week. */
export function startOfWeek(date: Date): Date {
  const day = date.getDay()
  const offset = day === 0 ? -6 : 1 - day
  return startOfDay(addDays(date, offset))
}

export function weekDays(date: Date): Date[] {
  const start = startOfWeek(date)
  return Array.from({ length: 7 }, (_, index) => addDays(start, index))
}

export function atTime(date: Date, hour: number, minute: number): Date {
  const next = new Date(date)
  next.setHours(hour, minute, 0, 0)
  return next
}

export function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

/** ISO string carrying the local UTC offset, e.g. 2026-11-06T09:00:00+08:00. */
export function isoWithOffset(date: Date): string {
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const abs = Math.abs(offset)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${pad(
    Math.floor(abs / 60),
  )}:${pad(abs % 60)}`
}

export function isoDateOnly(date: Date): string {
  return dateKey(date)
}

export function formatTime(iso: string | null): string {
  if (!iso) return '待安排'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '--:--'
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function formatTimeRange(start: string | null, end: string | null): string {
  if (!start) return '时间未定'
  if (!end) return formatTime(start)
  return `${formatTime(start)} – ${formatTime(end)}`
}

export function formatDayCN(date: Date): string {
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

export function formatDayLong(date: Date): string {
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`
}

export function weekdayCN(date: Date): string {
  return `周${WEEKDAY_CN[date.getDay()]}`
}

export function weekdayNarrow(date: Date): string {
  return WEEKDAY_CN[date.getDay()]
}

export function monthLabel(date: Date): string {
  const months = [
    '一月',
    '二月',
    '三月',
    '四月',
    '五月',
    '六月',
    '七月',
    '八月',
    '九月',
    '十月',
    '十一月',
    '十二月',
  ]
  return months[date.getMonth()]
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export function eventDayKey(event: { start: string | null; deadline?: string }): string | null {
  if (event.start) return dateKey(new Date(event.start))
  if (event.deadline) return event.deadline
  return null
}

export function minutesOfDay(iso: string): number {
  const date = new Date(iso)
  return date.getHours() * 60 + date.getMinutes()
}

export function durationMinutes(start: string | null, end: string | null): number {
  if (!start || !end) return 60
  return Math.max(15, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000))
}

export function relativeDayLabel(dayKey: string, today = new Date()): string {
  const target = parseDateKey(dayKey)
  const diff = Math.round(
    (startOfDay(target).getTime() - startOfDay(today).getTime()) / 86_400_000,
  )
  if (diff === 0) return '今天'
  if (diff === 1) return '明天'
  if (diff === 2) return '后天'
  if (diff === -1) return '昨天'
  return ''
}

export function isPastDay(dayKey: string, today = new Date()): boolean {
  return parseDateKey(dayKey) < startOfDay(today)
}
