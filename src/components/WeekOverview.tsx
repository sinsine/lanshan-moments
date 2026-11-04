import { useEffect, useId, useMemo, useState } from 'react'
import type { ScheduleEvent } from '../types'
import {
  addDays,
  dateKey,
  formatDayCN,
  formatTimeRange,
  sameDay,
  startOfDay,
  weekDays,
  weekdayCN,
} from '../lib/date'
import { Icon } from './Icons'

const COPY = {
  title: '本周',
  yearSuffix: '年',
  rangeSeparator: ' – ',
  dateRangeSeparator: ' – ',
  yearRangeSeparator: '–',
  previousWeek: '上一周',
  nextWeek: '下一周',
  backToThisWeek: '回到本周',
  today: '今天',
  allDay: '全天',
  timedEvents: '定时日程',
  locationPending: '地点待定',
  endPending: '结束待定',
  tentative: '待确认',
  untitled: '未命名日程',
  unscheduled: '待安排',
  unscheduledHint: '这些时刻还没有确定具体时间',
  emptyDay: '暂无安排',
  openDay: '打开当日',
  syncNow: '立即同步',
  configureSync: '配置 GitHub 同步',
  syncing: '同步中',
  weekGridLabel: '周一至周日',
  weekNavigation: '周切换',
  weekSummary: (count: number) => `共 ${count} 个日程`,
  eventCount: (count: number) => `${count} 项`,
  openDayAria: (date: string, weekday: string, count: number) =>
    `打开 ${date} ${weekday} 的日程，共 ${count} 项`,
  locationPendingValues: ['待定', '暂不确定', '未知'],
} as const

const PENDING_LOCATIONS = new Set<string>(COPY.locationPendingValues)

export interface WeekOverviewProps {
  events: ScheduleEvent[]
  selectedDate: Date
  onSelectDate: (date: Date) => void
  onShiftWeek: (direction: -1 | 1) => void
  onToday: () => void
  onEventClick: (event: ScheduleEvent) => void
  onOpenDay: (date: Date) => void
  onSync: () => void
  onOpenSettings: () => void
  syncLabel: string
  syncConnected: boolean
  syncing: boolean
}

interface DayBucket {
  day: Date
  allDay: ScheduleEvent[]
  timed: ScheduleEvent[]
}

interface WeekBuckets {
  days: DayBucket[]
  unscheduled: ScheduleEvent[]
}

interface WeekEventCardProps {
  event: ScheduleEvent
  variant?: 'day' | 'unscheduled'
  onEventClick: (event: ScheduleEvent) => void
}

function toDate(iso: string | null): Date | null {
  if (!iso) return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

function titleOf(event: ScheduleEvent): string {
  const title = typeof event.title === 'string' ? event.title.trim() : ''
  return title || COPY.untitled
}

function locationOf(event: ScheduleEvent): string {
  const location = typeof event.location === 'string' ? event.location.trim() : ''
  return location && !PENDING_LOCATIONS.has(location) ? location : ''
}

function timeOf(event: ScheduleEvent): number {
  return toDate(event.start)?.getTime() ?? Number.MAX_SAFE_INTEGER
}

function compareEvents(a: ScheduleEvent, b: ScheduleEvent): number {
  return timeOf(a) - timeOf(b) || titleOf(a).localeCompare(titleOf(b), 'zh-CN')
}

function allDayDateLabel(event: ScheduleEvent): string {
  const start = toDate(event.start)
  if (!start) return ''
  const end = toDate(event.end)
  if (!end) return formatDayCN(start)

  const startDay = startOfDay(start)
  const endDay = startOfDay(end)
  const endsAtMidnight =
    end.getHours() === 0 &&
    end.getMinutes() === 0 &&
    end.getSeconds() === 0 &&
    end.getMilliseconds() === 0
  const inclusiveEnd =
    endsAtMidnight && endDay.getTime() > startDay.getTime()
      ? addDays(endDay, -1)
      : endDay

  if (sameDay(start, inclusiveEnd)) return formatDayCN(start)
  return `${formatDayCN(start)}${COPY.dateRangeSeparator}${formatDayCN(inclusiveEnd)}`
}

function buildWeekBuckets(events: ScheduleEvent[], week: Date[]): WeekBuckets {
  const days: DayBucket[] = week.map((day) => ({ day, allDay: [], timed: [] }))
  const bucketsByDate = new Map(days.map((bucket) => [dateKey(bucket.day), bucket]))
  const unscheduled: ScheduleEvent[] = []

  for (const event of events) {
    if (event.deletedAt) continue
    const start = toDate(event.start)
    if (!start) {
      unscheduled.push(event)
      continue
    }
    const bucket = bucketsByDate.get(dateKey(start))
    if (!bucket) continue
    if (event.allDay) bucket.allDay.push(event)
    else bucket.timed.push(event)
  }

  for (const bucket of days) {
    bucket.allDay.sort(compareEvents)
    bucket.timed.sort(compareEvents)
  }
  unscheduled.sort(compareEvents)

  return { days, unscheduled }
}

function WeekEventCard({ event, variant = 'day', onEventClick }: WeekEventCardProps) {
  const location = locationOf(event)
  const isTentative = event.status === 'tentative'
  const endMissing = !toDate(event.end)

  return (
    <button
      type="button"
      className={`week-event ${event.allDay ? 'week-event--all-day' : ''} ${
        variant === 'unscheduled' ? 'week-event--unscheduled' : ''
      } ${isTentative ? 'week-event--tentative' : ''}`}
      data-category={event.category}
      data-status={event.status}
      data-all-day={event.allDay ? 'true' : undefined}
      onClick={() => onEventClick(event)}
    >
      {variant === 'day' &&
        (event.allDay ? (
          <span className="week-event__time">
            <span className="week-event__allday">{COPY.allDay}</span>
            <span className="week-event__date">{allDayDateLabel(event)}</span>
          </span>
        ) : (
          <span className="week-event__time">
            <Icon name="clock" size={11} />
            <span className="week-event__range">
              {formatTimeRange(event.start, endMissing ? null : event.end)}
            </span>
            {endMissing && <span className="week-event__pending">{COPY.endPending}</span>}
          </span>
        ))}
      <span className="week-event__title">{titleOf(event)}</span>
      {location ? (
        <span className="week-event__location">
          <Icon name="pin" size={11} />
          <span>{location}</span>
        </span>
      ) : (
        <span className="week-event__location week-event__location--missing">
          <Icon name="alert" size={11} />
          <span>{COPY.locationPending}</span>
        </span>
      )}
      {isTentative && <span className="week-event__status">{COPY.tentative}</span>}
      {event.attendance === 'not_required' && (
        <span className="week-event__status">无需参加</span>
      )}
    </button>
  )
}

export function WeekOverview({
  events,
  selectedDate,
  onSelectDate,
  onShiftWeek,
  onToday,
  onEventClick,
  onOpenDay,
  onSync,
  onOpenSettings,
  syncLabel,
  syncConnected,
  syncing,
}: WeekOverviewProps) {
  const headingId = useId()
  const unscheduledId = useId()
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const week = useMemo(() => weekDays(selectedDate), [selectedDate])
  const { days, unscheduled } = useMemo(() => buildWeekBuckets(events, week), [events, week])

  const rangeLabel = `${formatDayCN(week[0])}${COPY.rangeSeparator}${formatDayCN(week[6])}`
  const startYear = week[0].getFullYear()
  const endYear = week[6].getFullYear()
  const yearLabel =
    startYear === endYear
      ? `${startYear}${COPY.yearSuffix}`
      : `${startYear}${COPY.yearRangeSeparator}${endYear}${COPY.yearSuffix}`
  const weekEventCount = days.reduce(
    (total, bucket) => total + bucket.allDay.length + bucket.timed.length,
    0,
  )
  const totalCount = weekEventCount + unscheduled.length

  const openDay = (day: Date) => {
    onSelectDate(day)
    onOpenDay(day)
  }

  return (
    <section className="week-overview" aria-labelledby={headingId}>
      <header className="week-overview__header">
        <div className="week-overview__heading">
          <div className="week-overview__title-row">
            <h2 className="week-overview__title" id={headingId}>
              {COPY.title}
            </h2>
            <span className="week-overview__year">{yearLabel}</span>
          </div>
          <p className="week-overview__range">{rangeLabel}</p>
          <p className="week-overview__summary">{COPY.weekSummary(totalCount)}</p>
        </div>

        <div className="week-overview__actions">
          <div className="week-overview__nav" role="group" aria-label={COPY.weekNavigation}>
            <button
              type="button"
              className="week-nav-button week-nav-button--previous"
              onClick={() => onShiftWeek(-1)}
              aria-label={COPY.previousWeek}
              title={COPY.previousWeek}
            >
              <Icon name="chevron-left" size={15} />
              <span>{COPY.previousWeek}</span>
            </button>
            <button
              type="button"
              className="week-nav-button week-nav-button--next"
              onClick={() => onShiftWeek(1)}
              aria-label={COPY.nextWeek}
              title={COPY.nextWeek}
            >
              <span>{COPY.nextWeek}</span>
              <Icon name="chevron-right" size={15} />
            </button>
          </div>
          <button
            type="button"
            className="week-today-button"
            onClick={onToday}
            aria-label={COPY.backToThisWeek}
            title={COPY.backToThisWeek}
          >
            <Icon name="calendar" size={14} />
            <span>{COPY.backToThisWeek}</span>
          </button>
          <button
            type="button"
            className={`week-sync-button ${syncConnected ? 'week-sync-button--on' : 'week-sync-button--off'} ${
              syncing ? 'week-sync-button--syncing' : ''
            }`}
            onClick={syncConnected ? onSync : onOpenSettings}
            title={syncConnected ? COPY.syncNow : COPY.configureSync}
            aria-label={
              syncing
                ? COPY.syncing
                : syncConnected
                  ? COPY.syncNow
                  : COPY.configureSync
            }
            aria-busy={syncing}
          >
            <Icon
              name={syncConnected ? (syncing ? 'refresh' : 'cloud') : 'cloud-off'}
              size={15}
            />
            <span>{syncing ? COPY.syncing : syncLabel}</span>
          </button>
        </div>
      </header>

      <ol className="week-grid" aria-label={COPY.weekGridLabel}>
        {days.map(({ day, allDay, timed }) => {
          const key = dateKey(day)
          const isToday = sameDay(day, now)
          const isSelected = sameDay(day, selectedDate)
          const count = allDay.length + timed.length
          const dayAria = COPY.openDayAria(formatDayCN(day), weekdayCN(day), count)

          return (
            <li
              key={key}
              className={`week-day-column ${
                isToday ? 'week-day-column--today' : ''
              } ${isSelected ? 'week-day-column--selected' : ''}`}
              data-date={key}
              data-today={isToday ? 'true' : undefined}
              data-selected={isSelected ? 'true' : undefined}
              data-event-count={count}
            >
              <button
                type="button"
                className="week-day-column__header"
                onClick={() => openDay(day)}
                aria-label={dayAria}
                aria-current={isToday ? 'date' : undefined}
              >
                <span className="week-day-column__weekday">{weekdayCN(day)}</span>
                <span className="week-day-column__date">{formatDayCN(day)}</span>
                <span className="week-day-column__count">{COPY.eventCount(count)}</span>
                {isToday && (
                  <span className="week-day-column__today">{COPY.today}</span>
                )}
              </button>

              <div className="week-day-column__body">
                {allDay.length > 0 && (
                  <ul className="week-day-column__allday" aria-label={COPY.allDay}>
                    {allDay.map((event) => (
                      <li className="week-event-row" key={event.id}>
                        <WeekEventCard event={event} onEventClick={onEventClick} />
                      </li>
                    ))}
                  </ul>
                )}

                {timed.length > 0 && (
                  <ul className="week-day-column__events" aria-label={COPY.timedEvents}>
                    {timed.map((event) => (
                      <li className="week-event-row" key={event.id}>
                        <WeekEventCard event={event} onEventClick={onEventClick} />
                      </li>
                    ))}
                  </ul>
                )}

                {count === 0 && (
                  <button
                    type="button"
                    className="week-day-column__empty"
                    onClick={() => openDay(day)}
                    aria-label={dayAria}
                  >
                    <span className="week-day-column__empty-text">{COPY.emptyDay}</span>
                    <span className="week-day-column__empty-action">{COPY.openDay}</span>
                  </button>
                )}
              </div>

              {count > 0 && (
                <button
                  type="button"
                  className="week-day-column__open"
                  onClick={() => openDay(day)}
                  aria-label={dayAria}
                >
                  <span>{COPY.openDay}</span>
                  <Icon name="arrow-right" size={13} />
                </button>
              )}
            </li>
          )
        })}
      </ol>

      {unscheduled.length > 0 && (
        <section className="week-unscheduled" aria-labelledby={unscheduledId}>
          <header className="week-unscheduled__header">
            <div className="week-unscheduled__heading">
              <h3 className="week-unscheduled__title" id={unscheduledId}>
                <Icon name="inbox" size={15} />
                <span>{COPY.unscheduled}</span>
              </h3>
              <p className="week-unscheduled__hint">{COPY.unscheduledHint}</p>
            </div>
            <span className="week-unscheduled__count">
              {COPY.eventCount(unscheduled.length)}
            </span>
          </header>
          <ul className="week-unscheduled__list" aria-label={COPY.unscheduled}>
            {unscheduled.map((event) => (
              <li className="week-event-row" key={event.id}>
                <WeekEventCard
                  event={event}
                  variant="unscheduled"
                  onEventClick={onEventClick}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  )
}
