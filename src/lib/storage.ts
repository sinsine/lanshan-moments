import type {
  AppSettings,
  Attendance,
  AttachedImage,
  DraftEvent,
  EventCategory,
  ScheduleDocument,
  ScheduleEvent,
} from '../types'
import { atTime, isoWithOffset, TIMEZONE } from './date'

const EVENTS_KEY = 'lanshan.events.v1'
const SETTINGS_KEY = 'lanshan.settings.v1'
const DEVICE_KEY = 'lanshan.device.v1'
const API_KEY = 'lanshan.api-key'
const GITHUB_TOKEN = 'lanshan.github-token'

export const DEFAULT_SETTINGS: AppSettings = {
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  githubOwner: '',
  githubRepo: 'lanshan-schedule',
  githubBranch: 'main',
  githubClientId: '',
  theme: 'dark',
}

export function getDeviceId(): string {
  const existing = localStorage.getItem(DEVICE_KEY)
  if (existing) return existing
  const id = `dev_${crypto.randomUUID().slice(0, 8)}`
  localStorage.setItem(DEVICE_KEY, id)
  return id
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return DEFAULT_SETTINGS
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AppSettings>) }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

export function loadApiKey(): string {
  return localStorage.getItem(API_KEY) ?? ''
}

export function saveApiKey(key: string): void {
  if (key) localStorage.setItem(API_KEY, key)
  else localStorage.removeItem(API_KEY)
}

export function loadGithubToken(): string {
  return localStorage.getItem(GITHUB_TOKEN) ?? ''
}

export function saveGithubToken(token: string): void {
  if (token) localStorage.setItem(GITHUB_TOKEN, token)
  else localStorage.removeItem(GITHUB_TOKEN)
}

export function loadEvents(): ScheduleEvent[] | null {
  try {
    const raw = localStorage.getItem(EVENTS_KEY)
    if (raw === null) return null
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return null
    return parsed.filter(isScheduleEvent).map((event) => ({
      ...event,
      location: event.location ?? '',
      attendance: event.attendance ?? ('unknown' as Attendance),
    }))
  } catch {
    return null
  }
}

export function saveEvents(events: ScheduleEvent[]): void {
  localStorage.setItem(EVENTS_KEY, JSON.stringify(events))
}

function isScheduleEvent(value: unknown): value is ScheduleEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Partial<ScheduleEvent>
  return typeof event.id === 'string' && typeof event.title === 'string'
}

function seedEvent(
  now: Date,
  dayOffset: number,
  hour: number,
  minute: number,
  duration: number,
  title: string,
  category: EventCategory,
  location: string,
  deviceId: string,
): ScheduleEvent {
  const day = new Date(now)
  day.setDate(day.getDate() + dayOffset)
  const start = atTime(day, hour, minute)
  const end = new Date(start.getTime() + duration * 60_000)
  const timestamp = new Date().toISOString()
  return {
    id: `evt_seed_${dayOffset}_${hour}_${minute}`,
    title,
    start: isoWithOffset(start),
    end: isoWithOffset(end),
    allDay: false,
    timezone: TIMEZONE,
    location,
    category,
    status: 'confirmed',
    attendance: 'required',
    source: { kind: 'manual' },
    confidence: 1,
    warnings: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    deviceId,
    rev: 1,
  }
}

export function createSeedEvents(now: Date, deviceId: string): ScheduleEvent[] {
  return [
    seedEvent(now, 0, 9, 30, 30, '晨会 · 本周三件事', 'work', '线上', deviceId),
    seedEvent(now, 0, 14, 0, 90, '首页视觉走查', 'work', '3 楼小会议室', deviceId),
    seedEvent(now, 0, 19, 30, 45, '沿江慢跑 5km', 'health', '滨江绿道', deviceId),
    seedEvent(now, 1, 11, 0, 45, '牙医复诊', 'health', '和睦口腔', deviceId),
    seedEvent(now, 1, 16, 0, 60, '和阿岚喝咖啡', 'life', '山止咖啡', deviceId),
    seedEvent(now, 2, 20, 0, 120, '电影《晒后假日》', 'life', '百丽宫影城', deviceId),
  ]
}

export function makeScheduleDocument(
  events: ScheduleEvent[],
  deviceId: string,
): ScheduleDocument {
  return {
    schemaVersion: '1.0',
    timezone: TIMEZONE,
    updatedAt: new Date().toISOString(),
    deviceId,
    events,
  }
}

export function draftsToEvents(drafts: DraftEvent[]): ScheduleEvent[] {
  return drafts
    .filter((draft) => draft.selected)
    .map((draft) => {
      const { selected: _selected, questions: _questions, ...event } = draft
      void _selected
      void _questions
      return {
        ...event,
        location: event.location.trim(),
        status: event.warnings.length ? 'tentative' : 'confirmed',
      }
    })
}

export function formatScheduleJson(document: ScheduleDocument): string {
  return JSON.stringify(document, null, 2)
}

export function copyText(text: string): Promise<void> {
  return navigator.clipboard.writeText(text)
}

export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export async function fileToAttachedImage(file: File): Promise<AttachedImage> {
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件')
  if (file.size > 15 * 1024 * 1024) throw new Error('图片超过 15MB，请压缩后再试')
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image()
    element.onload = () => resolve(element)
    element.onerror = () => reject(new Error('图片格式无法识别'))
    element.src = dataUrl
  })

  const maxEdge = 1600
  const ratio = Math.min(1, maxEdge / Math.max(image.width, image.height))
  const width = Math.round(image.width * ratio)
  const height = Math.round(image.height * ratio)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return { name: file.name, dataUrl, width: image.width, height: image.height }
  context.drawImage(image, 0, 0, width, height)
  return {
    name: file.name,
    dataUrl: canvas.toDataURL('image/jpeg', 0.84),
    width,
    height,
  }
}
