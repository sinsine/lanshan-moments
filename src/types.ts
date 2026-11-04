export type EventCategory = 'work' | 'life' | 'health' | 'focus' | 'other'
export type EventStatus = 'confirmed' | 'tentative'
export type SourceKind = 'text' | 'image' | 'manual'
export type Attendance = 'unknown' | 'required' | 'optional' | 'not_required'
export type ClarifyField = 'start' | 'end' | 'location' | 'attendance' | 'title' | 'other'

export interface ClarifyOption {
  id: string
  label: string
  /** Raw answer used by the app: ISO time, location text, or attendance enum. */
  value?: string
}

export interface ClarifyQuestion {
  id: string
  field: ClarifyField
  prompt: string
  options: ClarifyOption[]
  allowCustom: boolean
  customPlaceholder?: string
  selectedOptionId?: string
  answer?: string
}

export interface EventSource {
  kind: SourceKind
  excerpt?: string
}

export interface ScheduleEvent {
  id: string
  title: string
  /** ISO 8601 with offset. null means the event has no agreed time yet. */
  start: string | null
  end: string | null
  allDay: boolean
  timezone: string
  /** Required for a confirmed event. May be "待定" when the user explicitly chooses it. */
  location: string
  notes?: string
  /** YYYY-MM-DD, for tasks without a concrete time. */
  deadline?: string
  category: EventCategory
  status: EventStatus
  attendance: Attendance
  source: EventSource
  confidence: number
  warnings: string[]
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
  deviceId: string
  rev: number
}

export interface DraftEvent extends ScheduleEvent {
  selected: boolean
  questions: ClarifyQuestion[]
}

export interface ScheduleDocument {
  schemaVersion: '1.0'
  timezone: string
  updatedAt: string
  deviceId: string
  events: ScheduleEvent[]
}

export interface AppSettings {
  baseUrl: string
  model: string
  githubOwner: string
  githubRepo: string
  githubBranch: string
  githubClientId: string
  theme: 'dark' | 'light'
}

export interface AttachedImage {
  name: string
  dataUrl: string
  width: number
  height: number
}

export type ParseEngine = 'ai' | 'local'

export interface ParseResult {
  drafts: DraftEvent[]
  engine: ParseEngine
  model?: string
  note?: string
}
