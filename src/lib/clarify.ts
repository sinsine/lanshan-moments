import type { ClarifyOption, ClarifyQuestion, DraftEvent, ScheduleEvent } from '../types'
import { atTime, isoWithOffset } from './date'

export interface ClarifyResult {
  draft: DraftEvent
  error?: string
}

function parseTimeAnswer(start: string | null, text: string): string | null {
  const value = text.trim()
  if (!value) return null
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : isoWithOffset(date)
  }
  if (!start) return null
  const startDate = new Date(start)
  const clock = value.match(/^(\d{1,2})\s*[:：]\s*(\d{2})$/)
  if (clock) {
    const hour = Number(clock[1])
    const minute = Number(clock[2])
    if (hour > 23 || minute > 59) return null
    return isoWithOffset(atTime(startDate, hour, minute))
  }
  const half = /半小时/.test(value) ? 30 : 0
  const hours = value.match(/(\d+(?:\.\d+)?)\s*个?\s*小时/)
  const minutes = value.match(/(\d+)\s*分钟/)
  const delta = half || (hours ? Number(hours[1]) * 60 : minutes ? Number(minutes[1]) : 0)
  if (!delta) return null
  return isoWithOffset(new Date(startDate.getTime() + delta * 60_000))
}

function markAnswered(
  draft: DraftEvent,
  questionId: string,
  option: ClarifyOption | null,
  answer: string,
): DraftEvent {
  return {
    ...draft,
    questions: draft.questions.map((question) =>
      question.id === questionId
        ? {
            ...question,
            selectedOptionId: option?.id,
            answer,
          }
        : question,
    ),
  }
}

export function applyClarifyOption(
  draft: DraftEvent,
  question: ClarifyQuestion,
  option: ClarifyOption,
): ClarifyResult {
  const value = option.value ?? option.label
  let next: DraftEvent = draft

  if (question.field === 'location') {
    next = { ...draft, location: value, warnings: draft.warnings.filter((w) => w !== '地点待确认') }
  } else if (question.field === 'end') {
    const end = parseTimeAnswer(draft.start, value)
    if (!end) return { draft, error: '没有读懂这个结束时间，请换一种写法' }
    if (draft.start && new Date(end) <= new Date(draft.start)) {
      return { draft, error: '结束时间必须晚于开始时间' }
    }
    next = {
      ...draft,
      end,
      allDay: false,
      warnings: draft.warnings.filter((w) => w !== '结束时间待确认'),
    }
  } else if (question.field === 'start') {
    const start = parseTimeAnswer(draft.start, value)
    if (!start) return { draft, error: '没有读懂这个开始时间，请换一种写法' }
    next = { ...draft, start, allDay: false }
  } else if (question.field === 'attendance') {
    const attendance =
      value === 'required' || value === 'optional' || value === 'not_required'
        ? value
        : 'unknown'
    next = { ...draft, attendance }
  } else if (question.field === 'title') {
    next = { ...draft, title: value }
  }

  next = markAnswered(next, question.id, option, option.label)
  return { draft: next }
}

export function applyClarifyCustom(
  draft: DraftEvent,
  question: ClarifyQuestion,
  text: string,
): ClarifyResult {
  const value = text.trim()
  if (!value) return { draft, error: '请输入一个答案' }
  let next = draft

  if (question.field === 'location') {
    next = { ...draft, location: value, warnings: draft.warnings.filter((w) => w !== '地点待确认') }
  } else if (question.field === 'end') {
    const end = parseTimeAnswer(draft.start, value)
    if (!end) return { draft, error: '可以输入「16:30」「1.5 小时」或完整时间' }
    if (draft.start && new Date(end) <= new Date(draft.start)) {
      return { draft, error: '结束时间必须晚于开始时间' }
    }
    next = {
      ...draft,
      end,
      allDay: false,
      warnings: draft.warnings.filter((w) => w !== '结束时间待确认'),
    }
  } else if (question.field === 'start') {
    const start = parseTimeAnswer(draft.start, value)
    if (!start) return { draft, error: '可以输入「15:00」或完整时间' }
    next = { ...draft, start, allDay: false }
  } else if (question.field === 'attendance') {
    next = { ...draft, attendance: /不|无需|不用/.test(value) ? 'not_required' : 'required' }
  } else if (question.field === 'title') {
    next = { ...draft, title: value }
  }

  next = markAnswered(next, question.id, null, value)
  return { draft: next }
}

export function missingRequiredFields(event: ScheduleEvent): string[] {
  const missing: string[] = []
  if (!event.start) missing.push('开始时间')
  if (!event.end) missing.push('结束时间')
  if (!event.location?.trim()) missing.push('地点')
  if (event.start && event.end && new Date(event.end) <= new Date(event.start)) {
    missing.push('有效的结束时间')
  }

  // A value inferred by the parser is still a question until the user answers
  // it. Otherwise a default one-hour duration would silently become fact.
  const draft = event as Partial<DraftEvent>
  for (const question of draft.questions ?? []) {
    if (question.answer) continue
    if (question.field === 'start' && !missing.includes('开始时间')) {
      missing.push('开始时间（待确认）')
    }
    if (question.field === 'end' && !missing.includes('结束时间')) {
      missing.push('结束时间（待确认）')
    }
    if (question.field === 'location' && !missing.includes('地点')) {
      missing.push('地点（待确认）')
    }
  }
  return Array.from(new Set(missing))
}

export function openQuestionCount(event: DraftEvent): number {
  return event.questions.filter((question) => !question.answer).length
}

