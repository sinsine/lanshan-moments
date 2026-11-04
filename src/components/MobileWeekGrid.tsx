import { useEffect, useMemo, useRef, useState } from 'react'
import type { ScheduleEvent } from '../types'
import {
  dateKey,
  durationMinutes,
  formatDayCN,
  formatTime,
  minutesOfDay,
  sameDay,
  startOfDay,
  weekDays,
  weekdayNarrow,
} from '../lib/date'
import { Icon } from './Icons'

const START_HOUR = 8
const END_HOUR = 22
const HOUR_HEIGHT = 44
const WINDOW_START = START_HOUR * 60
const WINDOW_END = END_HOUR * 60
const CANVAS_PAD = 8
const CANVAS_HEIGHT = ((END_HOUR - START_HOUR) * 60 * HOUR_HEIGHT) / 60
const MIN_EVENT_HEIGHT = 18
const WEEK_MS = 7 * 86_400_000

const COPY = {
  rootLabel: '本周课程表',
  title: (week: number) => `第 ${week} 周`,
  weekMenu: '周切换',
  previousWeek: '上一周',
  thisWeek: '本周',
  nextWeek: '下一周',
  add: '添加日程',
  addAction: '添加日程',
  allDay: '全天',
  untitled: '未命名日程',
  emptyTitle: '本周还没有安排',
  emptyHint: '留一点空白，也很好。',
  unscheduledHint: (count: number) => `另有 ${count} 件事还待安排`,
  outOfWindow: (count: number) => `另有 ${count} 个日程在 08:00–22:00 之外`,
  weekdayPrefix: '周',
  rangeSeparator: ' – ',
  dayAria: (date: string, weekday: string, count: number) =>
    `${date} ${weekday}，${count} 个日程`,
  eventAria: (time: string, title: string, location: string) =>
    location ? `${time} ${title}，${location}` : `${time} ${title}`,
  pendingLocations: ['待定', '暂不确定', '未知'],
} as const

const PENDING_LOCATIONS = new Set<string>(COPY.pendingLocations)

interface MobileWeekGridProps {
  events: ScheduleEvent[]
  selectedDate: Date
  onSelectDate: (date: Date) => void
  onShiftWeek: (direction: -1 | 1) => void
  onOpenDay: (date: Date) => void
  onEventClick: (event: ScheduleEvent) => void
  onAdd: () => void
}

interface PlacedEvent {
  event: ScheduleEvent
  top: number
  height: number
  left: number
  width: number
  columns: number
}

interface DayBucket {
  day: Date
  allDay: ScheduleEvent[]
  timed: ScheduleEvent[]
  placed: PlacedEvent[]
}

interface Slot {
  event: ScheduleEvent
  start: number
  end: number
}

/** ISO-8601 week number, computed locally so the component needs no dependency. */
function isoWeekNumber(date: Date): number {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const weekday = target.getUTCDay() || 7
  target.setUTCDate(target.getUTCDate() + 4 - weekday)
  const yearStart = Date.UTC(target.getUTCFullYear(), 0, 1)
  return Math.ceil(((target.getTime() - yearStart) / 86_400_000 + 1) / 7)
}

function titleOf(event: ScheduleEvent): string {
  const title = typeof event.title === 'string' ? event.title.trim() : ''
  return title || COPY.untitled
}

function locationOf(event: ScheduleEvent): string {
  const location = typeof event.location === 'string' ? event.location.trim() : ''
  return location && !PENDING_LOCATIONS.has(location) ? location : ''
}

function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`
}

function toDate(iso: string | null): Date | null {
  if (!iso) return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Lays one day out in minute space: overlapping events are split into columns. */
function placeDay(events: ScheduleEvent[]): PlacedEvent[] {
  const slots: Slot[] = []
  for (const event of events) {
    const startDate = toDate(event.start)
    if (!event.start || !startDate) continue
    const start = minutesOfDay(event.start)
    const endDate = toDate(event.end)
    const end =
      endDate && endDate.getTime() > startDate.getTime()
        ? start + durationMinutes(event.start, event.end)
        : start + 60
    slots.push({ event, start, end })
  }
  slots.sort((a, b) => a.start - b.start || a.end - b.end)

  const placed: PlacedEvent[] = []
  let cluster: Slot[] = []
  let clusterEnd = -1

  const flush = () => {
    if (cluster.length === 0) return
    const columns: Slot[][] = []
    const assigned: Array<{ slot: Slot; column: number }> = []
    for (const slot of cluster) {
      let column = columns.findIndex(
        (items) => items[items.length - 1].end <= slot.start,
      )
      if (column === -1) {
        columns.push([slot])
        column = columns.length - 1
      } else {
        columns[column].push(slot)
      }
      assigned.push({ slot, column })
    }

    const columnCount = columns.length
    const width = 100 / columnCount
    for (const { slot, column } of assigned) {
      if (slot.start >= WINDOW_END || slot.end <= WINDOW_START) continue
      const from = Math.max(WINDOW_START, slot.start)
      const to = Math.min(WINDOW_END, slot.end)
      placed.push({
        event: slot.event,
        top: ((from - WINDOW_START) / 60) * HOUR_HEIGHT,
        height: Math.max(MIN_EVENT_HEIGHT, ((to - from) / 60) * HOUR_HEIGHT - 2),
        left: column * width,
        width,
        columns: columnCount,
      })
    }

    cluster = []
    clusterEnd = -1
  }

  for (const slot of slots) {
    if (cluster.length > 0 && slot.start >= clusterEnd) flush()
    cluster.push(slot)
    clusterEnd = Math.max(clusterEnd, slot.end)
  }
  flush()

  return placed
}

export function MobileWeekGrid({
  events,
  selectedDate,
  onSelectDate,
  onShiftWeek,
  onOpenDay,
  onEventClick,
  onAdd,
}: MobileWeekGridProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const scrollRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const scrolledRef = useRef(false)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  // Open near "now" the first time the grid appears — the week table is long.
  useEffect(() => {
    if (scrolledRef.current) return
    scrolledRef.current = true
    const node = scrollRef.current
    if (!node) return
    const current = new Date()
    if (!weekDays(selectedDate).some((day) => sameDay(day, current))) return
    const minutes = current.getHours() * 60 + current.getMinutes()
    if (minutes < WINDOW_START || minutes > WINDOW_END) return
    node.scrollTop = Math.max(0, ((minutes - WINDOW_START) / 60) * HOUR_HEIGHT - 72)
  }, [selectedDate])

  const week = useMemo(() => weekDays(selectedDate), [selectedDate])

  const days = useMemo<DayBucket[]>(() => {
    const live = events.filter((event) => !event.deletedAt)
    return week.map((day) => {
      const allDay: ScheduleEvent[] = []
      const timed: ScheduleEvent[] = []
      for (const event of live) {
        const start = toDate(event.start)
        if (!start || !sameDay(start, day)) continue
        if (event.allDay) allDay.push(event)
        else timed.push(event)
      }
      allDay.sort((a, b) => titleOf(a).localeCompare(titleOf(b), 'zh-CN'))
      timed.sort(
        (a, b) =>
          (toDate(a.start)?.getTime() ?? 0) - (toDate(b.start)?.getTime() ?? 0) ||
          titleOf(a).localeCompare(titleOf(b), 'zh-CN'),
      )
      return { day, allDay, timed, placed: placeDay(timed) }
    })
  }, [events, week])

  const weekStart = week[0]
  const weekEnd = week[6]
  const weekNumber = isoWeekNumber(selectedDate)
  const rangeLabel = `${formatDayCN(weekStart)}${COPY.rangeSeparator}${formatDayCN(weekEnd)}`

  const todayWeekStart = startOfDay(weekDays(now)[0])
  const shownWeekStart = startOfDay(weekStart)
  const weekDelta = Math.round(
    (todayWeekStart.getTime() - shownWeekStart.getTime()) / WEEK_MS,
  )
  const isCurrentWeek = weekDelta === 0

  const weekCount = days.reduce(
    (total, bucket) => total + bucket.allDay.length + bucket.timed.length,
    0,
  )
  const hiddenCount = days.reduce(
    (total, bucket) => total + bucket.timed.length - bucket.placed.length,
    0,
  )
  const unscheduledCount = events.filter(
    (event) => !event.deletedAt && !toDate(event.start),
  ).length

  const allDayItems = days.flatMap(({ day, allDay }) =>
    allDay.map((event) => ({ day, event })),
  )

  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const nowVisible = nowMinutes >= WINDOW_START && nowMinutes <= WINDOW_END
  const nowTop = ((nowMinutes - WINDOW_START) / 60) * HOUR_HEIGHT
  const hours = Array.from(
    { length: END_HOUR - START_HOUR + 1 },
    (_, index) => START_HOUR + index,
  )

  const openDay = (day: Date) => {
    onSelectDate(day)
    onOpenDay(day)
  }

  const goToCurrentWeek = () => {
    if (weekDelta !== 0) {
      const direction: -1 | 1 = weekDelta > 0 ? 1 : -1
      for (let step = 0; step < Math.abs(weekDelta); step += 1) onShiftWeek(direction)
    }
    onSelectDate(startOfDay(new Date()))
    setMenuOpen(false)
  }

  return (
    <section className="mw-root" aria-label={COPY.rootLabel}>
      <style>{STYLES}</style>

      <header className="mw-head">
        <button
          className="mw-add"
          type="button"
          onClick={onAdd}
          aria-label={COPY.add}
          title={COPY.add}
        >
          <Icon name="plus" size={16} />
        </button>

        <div className="mw-title-wrap" ref={menuRef}>
          <div className="mw-title-row">
            <h2 className="mw-title">{COPY.title(weekNumber)}</h2>
            <button
              className="mw-caret"
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-label={COPY.weekMenu}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              title={COPY.weekMenu}
            >
              <Icon name="chevron-right" size={13} />
            </button>
          </div>
          <p className="mw-range">{rangeLabel}</p>

          {menuOpen && (
            <div
              className="mw-menu"
              role="menu"
              aria-label={COPY.weekMenu}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
                const items = Array.from(
                  event.currentTarget.querySelectorAll<HTMLButtonElement>('.mw-menu__item'),
                )
                if (items.length === 0) return
                event.preventDefault()
                const active = items.indexOf(document.activeElement as HTMLButtonElement)
                const step = event.key === 'ArrowDown' ? 1 : -1
                const next =
                  active === -1
                    ? event.key === 'ArrowDown'
                      ? 0
                      : items.length - 1
                    : (active + step + items.length) % items.length
                items[next].focus()
              }}
            >
              <button
                className="mw-menu__item"
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false)
                  onShiftWeek(-1)
                }}
              >
                <span>{COPY.previousWeek}</span>
                <Icon name="chevron-left" size={11} />
              </button>
              <button
                className={`mw-menu__item ${isCurrentWeek ? 'mw-menu__item--active' : ''}`}
                type="button"
                role="menuitem"
                onClick={goToCurrentWeek}
              >
                <span>{COPY.thisWeek}</span>
                {isCurrentWeek && <Icon name="check" size={11} />}
              </button>
              <button
                className="mw-menu__item"
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false)
                  onShiftWeek(1)
                }}
              >
                <span>{COPY.nextWeek}</span>
                <Icon name="chevron-right" size={11} />
              </button>
            </div>
          )}
        </div>

        <div className="mw-nav">
          <button
            className="mw-nav__button"
            type="button"
            onClick={() => onShiftWeek(-1)}
            aria-label={COPY.previousWeek}
            title={COPY.previousWeek}
          >
            <Icon name="chevron-left" size={14} />
          </button>
          <button
            className="mw-nav__button"
            type="button"
            onClick={() => onShiftWeek(1)}
            aria-label={COPY.nextWeek}
            title={COPY.nextWeek}
          >
            <Icon name="chevron-right" size={14} />
          </button>
        </div>
      </header>

      <div className="mw-days">
        <span className="mw-days__gutter" aria-hidden="true" />
        {days.map(({ day, allDay, timed }) => {
          const key = dateKey(day)
          const isSelected = sameDay(day, selectedDate)
          const isToday = sameDay(day, now)
          const count = allDay.length + timed.length
          return (
            <button
              key={key}
              className={`mw-day ${isSelected ? 'mw-day--selected' : ''} ${
                isToday ? 'mw-day--today' : ''
              }`}
              type="button"
              onClick={() => openDay(day)}
              aria-pressed={isSelected}
              aria-current={isToday ? 'date' : undefined}
              aria-label={COPY.dayAria(
                formatDayCN(day),
                `${COPY.weekdayPrefix}${weekdayNarrow(day)}`,
                count,
              )}
              data-date={key}
            >
              <span className="mw-day__weekday">
                {COPY.weekdayPrefix}
                {weekdayNarrow(day)}
              </span>
              <span className="mw-day__num">
                {day.getDate()}
                <span className="mw-day__unit">日</span>
              </span>
              {isToday && <i className="mw-day__dot" aria-hidden="true" />}
            </button>
          )
        })}
      </div>

      <div className="mw-body">
        {allDayItems.length > 0 && (
          <div className="mw-allday">
            <span className="mw-allday__label">{COPY.allDay}</span>
            <div className="mw-allday__track">
              {allDayItems.map(({ day, event }) => (
                <button
                  key={event.id}
                  className="mw-allday__chip"
                  type="button"
                  onClick={() => onEventClick(event)}
                  aria-label={COPY.eventAria(COPY.allDay, titleOf(event), locationOf(event))}
                >
                  <span className="mw-allday__day">{day.getDate()}日</span>
                  <span className="mw-allday__title">{titleOf(event)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mw-scroll" ref={scrollRef}>
          <div className="mw-grid" style={{ height: CANVAS_HEIGHT + CANVAS_PAD * 2 }}>
            <div className="mw-grid__cols" style={{ top: CANVAS_PAD, height: CANVAS_HEIGHT }}>
              <div className="mw-gutter" aria-hidden="true">
                {hours.map((hour) => (
                  <span
                    key={hour}
                    className="mw-time"
                    style={{ top: (hour - START_HOUR) * HOUR_HEIGHT }}
                  >
                    {formatHour(hour)}
                  </span>
                ))}
              </div>

              {days.map(({ day, placed, allDay, timed }) => {
                const isSelected = sameDay(day, selectedDate)
                const isToday = sameDay(day, now)
                return (
                  <div
                    key={dateKey(day)}
                    className={`mw-col ${isSelected ? 'mw-col--selected' : ''}`}
                    data-date={dateKey(day)}
                    role="group"
                    aria-label={COPY.dayAria(
                      formatDayCN(day),
                      `${COPY.weekdayPrefix}${weekdayNarrow(day)}`,
                      allDay.length + timed.length,
                    )}
                  >
                    {placed.map(({ event, top, height, left, width, columns }) => {
                      const title = titleOf(event)
                      const location = locationOf(event)
                      const isTentative = event.status === 'tentative'
                      const compact = columns > 1
                      const showTime = height >= 26 && !compact
                      const showLocation = height >= 46 && !compact && Boolean(location)
                      return (
                        <button
                          key={event.id}
                          className={`mw-event mw-event--${event.category} ${
                            isTentative ? 'mw-event--tentative' : ''
                          } ${compact ? 'mw-event--compact' : ''}`}
                          type="button"
                          onClick={() => onEventClick(event)}
                          style={{
                            top,
                            height,
                            left: `calc(${left}% + 1px)`,
                            width: `calc(${width}% - 2px)`,
                          }}
                          aria-label={COPY.eventAria(
                            event.end
                              ? `${formatTime(event.start)}–${formatTime(event.end)}`
                              : formatTime(event.start),
                            title,
                            location,
                          )}
                          title={`${formatTime(event.start)} ${title}`}
                          data-event-id={event.id}
                          data-status={event.status}
                        >
                          {showTime && (
                            <span className="mw-event__time">{formatTime(event.start)}</span>
                          )}
                          <span className="mw-event__title">{title}</span>
                          {showLocation && (
                            <span className="mw-event__place">
                              <Icon name="pin" size={8} />
                              <span className="mw-event__place-text">{location}</span>
                            </span>
                          )}
                          {isTentative && <span className="mw-event__flag" aria-hidden="true" />}
                        </button>
                      )
                    })}

                    {isToday && nowVisible && (
                      <div className="mw-now" style={{ top: nowTop }} aria-hidden="true" />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {weekCount === 0 && (
          <div className="mw-empty">
            <div className="mw-empty__card">
              <span className="mw-empty__mark" aria-hidden="true">
                <Icon name="calendar" size={16} />
              </span>
              <p className="mw-empty__title">{COPY.emptyTitle}</p>
              <p className="mw-empty__hint">
                {unscheduledCount > 0
                  ? COPY.unscheduledHint(unscheduledCount)
                  : COPY.emptyHint}
              </p>
              <button className="mw-empty__action" type="button" onClick={onAdd}>
                <Icon name="plus" size={12} />
                <span>{COPY.addAction}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {hiddenCount > 0 && <p className="mw-note">{COPY.outOfWindow(hiddenCount)}</p>}
    </section>
  )
}

const STYLES = `
.mw-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: linear-gradient(180deg, var(--glass-bg), transparent 46%);
  color: var(--ink-0);
  font-family: var(--font-ui);
  box-shadow: var(--shadow-soft);
}

/* ---- header ---- */
.mw-head {
  position: relative;
  z-index: 6;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  min-height: 48px;
  padding: 7px 10px;
  border-bottom: 1px solid var(--line);
}
.mw-add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 1px solid var(--line);
  border-radius: 50%;
  background: var(--glass-bg);
  color: var(--ink-0);
  transition: background var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease),
    transform var(--dur-fast) var(--ease);
}
.mw-add:hover { background: var(--glass-bg-hover); border-color: var(--line-strong); }
.mw-add:active { transform: scale(0.94); }

.mw-title-wrap {
  position: absolute;
  left: 50%;
  top: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  transform: translate(-50%, -50%);
  white-space: nowrap;
}
.mw-title-row { display: flex; align-items: center; gap: 1px; }
.mw-title {
  margin: 0;
  color: var(--ink-0);
  font-family: var(--font-serif);
  font-size: 15px;
  font-weight: 500;
  line-height: 1.2;
  letter-spacing: 0.05em;
}
.mw-caret {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--faint);
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}
.mw-caret:hover { background: var(--glass-bg-hover); color: var(--ink-0); }
.mw-caret svg { transform: rotate(90deg); transition: transform var(--dur-fast) var(--ease); }
.mw-caret[aria-expanded='true'] svg { transform: rotate(-90deg); }
.mw-range {
  margin: 1px 0 0;
  color: var(--faint);
  font-family: var(--mono);
  font-size: 8.5px;
  line-height: 1.3;
  letter-spacing: 0.04em;
}

.mw-menu {
  position: absolute;
  top: calc(100% + 5px);
  left: 50%;
  z-index: 30;
  display: flex;
  flex-direction: column;
  min-width: 104px;
  padding: 4px;
  border: 1px solid var(--line-strong);
  border-radius: 12px;
  background: var(--bg-1);
  box-shadow: var(--shadow-glass);
  transform: translateX(-50%);
  animation: mw-pop 0.14s var(--ease);
}
.mw-menu__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 7px 9px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ink-1);
  font-family: var(--font-ui);
  font-size: 11px;
  text-align: left;
  white-space: nowrap;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}
.mw-menu__item:hover,
.mw-menu__item:focus-visible { background: var(--glass-bg-hover); color: var(--ink-0); }
.mw-menu__item--active { color: var(--ink-0); }

.mw-nav { display: flex; gap: 2px; }
.mw-nav__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 1px solid transparent;
  border-radius: 50%;
  background: transparent;
  color: var(--ink-2);
  transition: background var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}
.mw-nav__button:hover { border-color: var(--line); background: var(--glass-bg); color: var(--ink-0); }

/* ---- day header ---- */
.mw-days {
  display: grid;
  grid-template-columns: 34px repeat(7, minmax(0, 1fr));
  align-items: stretch;
  padding: 3px 0 4px;
  border-bottom: 1px solid var(--line);
}
.mw-days__gutter { display: block; }
.mw-day {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  min-width: 0;
  margin: 0 1px;
  padding: 4px 0 5px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--ink-2);
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}
.mw-day:hover { background: var(--glass-bg); color: var(--ink-1); }
.mw-day--selected { background: var(--glass-bg-active); color: var(--ink-0); }
.mw-day__weekday { font-size: 8.5px; line-height: 1.1; letter-spacing: 0.04em; }
.mw-day__num {
  color: var(--ink-1);
  font-family: var(--mono);
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  line-height: 1.15;
}
.mw-day--selected .mw-day__num,
.mw-day--today .mw-day__num { color: var(--ink-0); }
.mw-day__unit { margin-left: 1px; font-size: 6.5px; color: var(--faint); vertical-align: 1px; }
.mw-day__dot {
  position: absolute;
  bottom: 2px;
  left: 50%;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--text-strong);
  transform: translateX(-50%);
}

/* ---- body ---- */
.mw-body { position: relative; display: flex; flex-direction: column; flex: 1; min-height: 0; }

.mw-allday {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border-bottom: 1px solid var(--line);
}
.mw-allday__label { flex: none; color: var(--faint); font-size: 8.5px; letter-spacing: 0.04em; }
.mw-allday__track {
  display: flex;
  gap: 4px;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.mw-allday__track::-webkit-scrollbar { width: 0; height: 0; }
.mw-allday__chip {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 3px;
  max-width: 128px;
  padding: 2px 6px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--glass-bg);
  color: var(--ink-1);
  font-family: var(--font-ui);
  font-size: 9px;
  transition: background var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}
.mw-allday__chip:hover {
  border-color: var(--line-strong);
  background: var(--glass-bg-hover);
  color: var(--ink-0);
}
.mw-allday__day { color: var(--faint); font-family: var(--mono); font-size: 8px; }
.mw-allday__title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mw-scroll {
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.mw-scroll::-webkit-scrollbar { width: 0; height: 0; }

.mw-grid { position: relative; }
.mw-grid__cols {
  position: absolute;
  left: 0;
  right: 0;
  display: grid;
  grid-template-columns: 34px repeat(7, minmax(0, 1fr));
}
.mw-gutter { position: relative; }
.mw-time {
  position: absolute;
  right: 6px;
  color: var(--faint);
  font-family: var(--mono);
  font-size: 8px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.01em;
  line-height: 1;
  white-space: nowrap;
  transform: translateY(-50%);
}

.mw-col {
  position: relative;
  min-width: 0;
  border-left: 1px solid var(--line);
  background-color: transparent;
  background-image: repeating-linear-gradient(
    to bottom,
    var(--line) 0 1px,
    transparent 1px 44px
  );
  background-image: repeating-linear-gradient(
      to bottom,
      var(--line) 0 1px,
      transparent 1px 44px
    ),
    repeating-linear-gradient(
      to bottom,
      color-mix(in srgb, var(--line), transparent 62%) 0 1px,
      transparent 1px 22px
    );
}
.mw-col--selected { background-color: var(--amber-soft); }

.mw-event {
  position: absolute;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  padding: 2px 2px 2px 3px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-left: 2px solid var(--mw-bar, var(--line-strong));
  border-radius: 5px;
  background: var(--mw-fill, var(--panel-2));
  color: var(--ink-0);
  font-family: var(--font-ui);
  text-align: left;
  transition: background var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease);
}
.mw-event:hover { z-index: 3; border-color: var(--line-strong); background: var(--glass-bg-hover); }
.mw-event:focus-visible { z-index: 4; outline: 1px solid var(--text); outline-offset: 1px; }
.mw-event--work { --mw-bar: var(--line-strong); --mw-fill: var(--panel-2); }
.mw-event--focus { --mw-bar: var(--ink-0); --mw-fill: var(--panel-3); }
.mw-event--life { --mw-bar: var(--ink-2); --mw-fill: var(--panel-2); }
.mw-event--health { --mw-bar: var(--ink-1); --mw-fill: var(--panel); }
.mw-event--other { --mw-bar: var(--ink-3); --mw-fill: var(--panel); }
.mw-event--tentative {
  border-style: dashed;
  border-left-style: solid;
  background: transparent;
  color: var(--ink-1);
}
.mw-event--compact {
  padding: 2px 1px;
  border: 0;
  border-radius: 4px;
  box-shadow: inset 2px 0 0 var(--mw-bar, var(--line-strong));
}
.mw-event--compact.mw-event--tentative {
  outline: 1px dashed var(--line-strong);
  outline-offset: -1px;
  background: transparent;
}
.mw-event--compact .mw-event__title {
  font-size: 8px;
  line-height: 1.2;
  letter-spacing: 0;
}
.mw-event__time {
  color: var(--ink-2);
  font-family: var(--mono);
  font-size: 7.5px;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}
.mw-event__title {
  display: -webkit-box;
  overflow: hidden;
  font-size: 9.5px;
  font-weight: 500;
  line-height: 1.25;
  letter-spacing: 0.01em;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.mw-event__place {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  color: var(--ink-2);
  font-size: 7.5px;
  line-height: 1.2;
}
.mw-event__place-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mw-event__flag {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--ink-2);
}

.mw-now {
  position: absolute;
  left: 0;
  right: 0;
  z-index: 5;
  height: 0;
  border-top: 1px solid var(--text);
  opacity: 0.5;
  pointer-events: none;
}
.mw-now::before {
  content: '';
  position: absolute;
  top: -2.5px;
  left: -2px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--text);
}

/* ---- empty / footnote ---- */
.mw-empty {
  position: absolute;
  inset: 0;
  z-index: 8;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  pointer-events: none;
}
.mw-empty__card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  max-width: 220px;
  padding: 14px 18px 15px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--glass-bg);
  box-shadow: var(--shadow-soft);
  text-align: center;
  pointer-events: auto;
  backdrop-filter: blur(var(--glass-blur));
  -webkit-backdrop-filter: blur(var(--glass-blur));
}
.mw-empty__mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  margin-bottom: 1px;
  border: 1px solid var(--line);
  border-radius: 50%;
  color: var(--ink-1);
}
.mw-empty__title {
  margin: 0;
  color: var(--ink-0);
  font-family: var(--font-serif);
  font-size: 13px;
  letter-spacing: 0.04em;
}
.mw-empty__hint { margin: 0; color: var(--faint); font-size: 9px; line-height: 1.5; }
.mw-empty__action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 2px;
  padding: 4px 11px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: var(--glass-bg-hover);
  color: var(--ink-0);
  font-family: var(--font-ui);
  font-size: 10px;
  transition: background var(--dur-fast) var(--ease);
}
.mw-empty__action:hover { background: var(--glass-bg-active); }

.mw-note {
  flex: none;
  margin: 0;
  padding: 4px 10px;
  border-top: 1px solid var(--line);
  color: var(--faint);
  font-size: 8.5px;
  line-height: 1.4;
  text-align: center;
  letter-spacing: 0.02em;
}

@keyframes mw-pop {
  from { opacity: 0; transform: translate(-50%, -3px); }
  to { opacity: 1; transform: translate(-50%, 0); }
}

@media (prefers-reduced-motion: reduce) {
  .mw-add,
  .mw-caret svg,
  .mw-event,
  .mw-day,
  .mw-allday__chip,
  .mw-menu__item { transition: none; }
  .mw-menu { animation: none; }
}
`
