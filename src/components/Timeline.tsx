import { useEffect, useRef, useState } from 'react'
import type { DraftEvent, ScheduleEvent } from '../types'
import {
  dateKey,
  durationMinutes,
  formatDayCN,
  formatDayLong,
  formatTime,
  minutesOfDay,
  monthLabel,
  relativeDayLabel,
  sameDay,
  weekDays,
  weekdayCN,
  weekdayNarrow,
} from '../lib/date'
import { Icon } from './Icons'

const HOUR_HEIGHT = 48
const START_HOUR = 8
const END_HOUR = 23
const TOTAL_MINUTES = (END_HOUR - START_HOUR) * 60

interface TimelineProps {
  events: ScheduleEvent[]
  drafts: DraftEvent[]
  selectedDate: Date
  onSelectDate: (date: Date) => void
  onShiftWeek: (direction: -1 | 1) => void
  onToday: () => void
  onAdd: () => void
  onEventClick: (event: ScheduleEvent) => void
  onSync: () => void
  onOpenSettings: () => void
  syncLabel: string
  syncConnected: boolean
  syncing: boolean
}

interface Positioned {
  event: ScheduleEvent
  top: number
  height: number
  left: number
  width: number
}

function positionEvents(items: ScheduleEvent[]): Positioned[] {
  const sorted = items
    .filter((event) => event.start)
    .sort((a, b) => new Date(a.start!).getTime() - new Date(b.start!).getTime())
  const result: Positioned[] = []
  let cluster: ScheduleEvent[] = []
  let clusterEnd = -1

  const flush = () => {
    if (cluster.length === 0) return
    const columns: ScheduleEvent[][] = []
    for (const event of cluster) {
      const start = minutesOfDay(event.start!)
      const column = columns.findIndex((itemsInColumn) => {
        const last = itemsInColumn[itemsInColumn.length - 1]
        return minutesOfDay(last.end ?? last.start!) <= start
      })
      if (column >= 0) columns[column].push(event)
      else columns.push([event])
    }
    const columnWidth = 100 / columns.length
    columns.forEach((columnEvents, columnIndex) => {
      for (const event of columnEvents) {
        const start = Math.max(START_HOUR * 60, minutesOfDay(event.start!))
        const end = Math.min(
          END_HOUR * 60,
          start + durationMinutes(event.start, event.end),
        )
        if (start >= END_HOUR * 60 || end <= START_HOUR * 60) continue
        result.push({
          event,
          top: ((start - START_HOUR * 60) / 60) * HOUR_HEIGHT,
          height: Math.max(28, ((end - start) / 60) * HOUR_HEIGHT - 5),
          left: columnIndex * columnWidth,
          width: columnWidth,
        })
      }
    })
    cluster = []
    clusterEnd = -1
  }

  for (const event of sorted) {
    const start = minutesOfDay(event.start!)
    if (cluster.length > 0 && start >= clusterEnd) flush()
    cluster.push(event)
    clusterEnd = Math.max(clusterEnd, minutesOfDay(event.end ?? event.start!))
  }
  flush()
  return result
}

export function Timeline({
  events,
  drafts,
  selectedDate,
  onSelectDate,
  onShiftWeek,
  onToday,
  onAdd,
  onEventClick,
  onSync,
  onOpenSettings,
  syncLabel,
  syncConnected,
  syncing,
}: TimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [selectedDate])

  const week = weekDays(selectedDate)
  const liveEvents = events.filter((event) => !event.deletedAt)
  const dayEvents = liveEvents.filter(
    (event) => event.start && !event.allDay && sameDay(new Date(event.start), selectedDate),
  )
  const dayAllDay = liveEvents.filter(
    (event) => event.allDay && event.start && sameDay(new Date(event.start), selectedDate),
  )
  const previews = drafts.filter((draft) => {
    if (!draft.selected || !draft.start) return false
    return sameDay(new Date(draft.start), selectedDate)
  })
  const unscheduled = liveEvents.filter((event) => !event.start)

  const positioned = positionEvents([
    ...dayEvents,
    ...previews.map((draft) => ({ ...draft, id: `preview_${draft.id}` })),
  ])

  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const nowVisible =
    sameDay(now, selectedDate) && nowMinutes >= START_HOUR * 60 && nowMinutes <= END_HOUR * 60
  const nowTop = ((nowMinutes - START_HOUR * 60) / 60) * HOUR_HEIGHT
  const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, index) => START_HOUR + index)

  const monthText = monthLabel(selectedDate)
  const yearText = selectedDate.getFullYear()
  const selectedLabel = relativeDayLabel(dateKey(selectedDate), now)

  return (
    <section className="timeline" aria-label="时间轴">
      <header className="timeline__header">
        <div className="timeline__title">
          <div className="timeline__month">
            <span className="timeline__month-cn">{monthText}</span>
            <span className="timeline__year">{yearText}</span>
          </div>
          <p className="timeline__selected">
            {formatDayLong(selectedDate)}
            <span className="dot-separator">·</span>
            {weekdayCN(selectedDate)}
            {selectedLabel && <span className="today-pill">{selectedLabel}</span>}
          </p>
        </div>

        <div className="timeline__actions">
          <button className="ghost-button ghost-button--tiny today-button" onClick={onToday} type="button">
            今天
          </button>
          <div className="week-arrows">
            <button className="icon-button" onClick={() => onShiftWeek(-1)} aria-label="上一周">
              <Icon name="chevron-left" size={17} />
            </button>
            <button className="icon-button" onClick={() => onShiftWeek(1)} aria-label="下一周">
              <Icon name="chevron-right" size={17} />
            </button>
          </div>
          <button
            className={`sync-button ${syncConnected ? 'sync-button--on' : ''}`}
            onClick={syncConnected ? onSync : onOpenSettings}
            type="button"
            title={syncConnected ? '立即同步' : '配置 GitHub 同步'}
          >
            <Icon name={syncConnected ? (syncing ? 'refresh' : 'cloud') : 'cloud-off'} size={16} />
            <span>{syncing ? '同步中' : syncLabel}</span>
          </button>
        </div>
      </header>

      <div className="week-strip">
        {week.map((day) => {
          const key = dateKey(day)
          const isSelected = sameDay(day, selectedDate)
          const isToday = sameDay(day, now)
          const count = liveEvents.filter(
            (event) => event.start && sameDay(new Date(event.start), day),
          ).length
          const draftCount = drafts.filter(
            (draft) => draft.start && sameDay(new Date(draft.start), day),
          ).length
          return (
            <button
              key={key}
              className={`week-day ${isSelected ? 'week-day--selected' : ''} ${
                isToday ? 'week-day--today' : ''
              }`}
              onClick={() => onSelectDate(day)}
              type="button"
              aria-pressed={isSelected}
              aria-label={`${formatDayCN(day)} ${weekdayCN(day)}，${count} 个日程`}
            >
              <span className="week-day__name">{weekdayNarrow(day)}</span>
              <span className="week-day__number">{day.getDate()}</span>
              <span className="week-day__dots" aria-hidden="true">
                {Array.from({ length: Math.min(3, count) }, (_, index) => (
                  <i key={index} />
                ))}
                {draftCount > 0 && <i className="week-day__dot--draft" />}
              </span>
            </button>
          )
        })}
      </div>

      {(dayAllDay.length > 0 || unscheduled.length > 0) && (
        <div className="timeline__strip">
          <span className="timeline__strip-label">全天</span>
          <div className="timeline__strip-items">
            {dayAllDay.map((event) => (
              <button
                key={event.id}
                className={`allday-chip category-${event.category}`}
                onClick={() => onEventClick(event)}
                type="button"
              >
                {event.title}
              </button>
            ))}
            {unscheduled.length > 0 && (
              <span className="unscheduled-chip">
                <Icon name="inbox" size={13} />
                待安排 {unscheduled.length}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="timeline__scroll" ref={scrollRef}>
        <div className="timeline__canvas" style={{ height: TOTAL_MINUTES / 60 * HOUR_HEIGHT + 28 }}>
          {hours.map((hour) => (
            <div
              key={hour}
              className="hour-row"
              style={{ top: (hour - START_HOUR) * HOUR_HEIGHT + 14 }}
            >
              <span className="hour-row__label">{String(hour).padStart(2, '0')}:00</span>
              <span className="hour-row__line" />
            </div>
          ))}

          <div className="timeline__rail" aria-hidden="true">
            {positioned.map(({ event, top, height, left, width }) => {
              const isDraft = event.id.startsWith('preview_')
              return (
              <button
                key={event.id}
                className={`time-event category-${event.category} ${
                  isDraft || event.status === 'tentative' ? 'time-event--tentative' : ''
                }`}
                style={{
                  top: top + 14,
                  height,
                  left: `calc(${left}% + var(--time-gutter, 62px))`,
                  width: `calc(${width}% - var(--time-gutter, 62px) - 6px)`,
                }}
                onClick={() => {
                  if (!isDraft) onEventClick(event)
                }}
                type="button"
                tabIndex={isDraft ? -1 : 0}
              >
                <span className="time-event__time">{formatTime(event.start)}</span>
                <span className="time-event__title">{event.title}</span>
                {height > 44 && event.location && (
                  <span className="time-event__meta">
                    <Icon name="pin" size={11} />
                    {event.location}
                  </span>
                )}
                {isDraft && <span className="time-event__preview">预览</span>}
              </button>
              )
            })}
          </div>

          {nowVisible && (
            <div className="now-line" style={{ top: nowTop + 14 }} aria-hidden="true">
              <span className="now-line__time">
                现在 {String(now.getHours()).padStart(2, '0')}:
                {String(now.getMinutes()).padStart(2, '0')}
              </span>
              <span className="now-line__dot" />
              <span className="now-line__rule" />
            </div>
          )}

          {dayEvents.length === 0 && previews.length === 0 && (
            <div className="timeline__empty">
              <p className="eyebrow">留白</p>
              <h2>这一天还没有被安排</h2>
              <p>把脑海里那句“周五要开会”，先丢给左边。</p>
              <button className="ghost-button" onClick={onAdd} type="button">
                <Icon name="plus" size={16} />
                记一件事
              </button>
            </div>
          )}
        </div>
      </div>

      <footer className="timeline__footer">
        <span>
          <i className="legend-dot category-work" /> 工作
        </span>
        <span>
          <i className="legend-dot category-life" /> 生活
        </span>
        <span>
          <i className="legend-dot category-health" /> 健康
        </span>
        <span>
          <i className="legend-dot category-focus" /> 专注
        </span>
        <span className="timeline__footer-hint">
          {week[0].getMonth() + 1}/{week[0].getDate()} – {week[6].getMonth() + 1}/{week[6].getDate()}
          <span className="dot-separator">·</span>
          {positioned.length + dayAllDay.length} 个时刻
        </span>
      </footer>
    </section>
  )
}
