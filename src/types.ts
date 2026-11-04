export type EventCategory = 'work' | 'life' | 'health' | 'focus' | 'other'
export type EventStatus = 'confirmed' | 'tentative'
export type SourceKind = 'text' | 'image' | 'manual'

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
  location?: string
  notes?: string
  /** YYYY-MM-DD, for tasks without a concrete time. */
  deadline?: string
  category: EventCategory
  status: EventStatus
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
