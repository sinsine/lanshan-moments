import type { ScheduleEvent } from '../types'
import { formatDayCN, formatTimeRange, weekdayCN } from '../lib/date'
import { Icon } from './Icons'

interface EventDialogProps {
  event: ScheduleEvent
  onClose: () => void
  onDelete: (event: ScheduleEvent) => void
}

const CATEGORY_LABEL: Record<ScheduleEvent['category'], string> = {
  work: '工作',
  life: '生活',
  health: '健康',
  focus: '专注',
  other: '其他',
}

export function EventDialog({ event, onClose, onDelete }: EventDialogProps) {
  const start = event.start ? new Date(event.start) : null
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="event-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={event.title}
        onMouseDown={(mouseEvent) => mouseEvent.stopPropagation()}
      >
        <div className={`event-dialog__stripe category-${event.category}`} />
        <button className="icon-button event-dialog__close" onClick={onClose} aria-label="关闭">
          <Icon name="x" size={18} />
        </button>
        <div className="event-dialog__body">
          <p className={`category-label category-${event.category}`}>
            {CATEGORY_LABEL[event.category]}
          </p>
          <h2>{event.title}</h2>
          <p className="event-dialog__when">
            <Icon name="clock" size={15} />
            {start
              ? `${formatDayCN(start)} ${weekdayCN(start)} · ${formatTimeRange(event.start, event.end)}`
              : event.deadline
                ? `截止 ${event.deadline} · 时间未定`
                : '待安排'}
          </p>
          {event.location && (
            <p className="event-dialog__where">
              <Icon name="pin" size={15} />
              {event.location}
            </p>
          )}
          {event.notes && <p className="event-dialog__notes">{event.notes}</p>}
          {event.source.excerpt && (
            <div className="event-dialog__source">
              <span>来自</span>
              <blockquote>{event.source.excerpt}</blockquote>
            </div>
          )}
          <div className="event-dialog__meta">
            <span>把握 {Math.round(event.confidence * 100)}%</span>
            <span>{event.status === 'tentative' ? '待确认' : '已确认'}</span>
            <span>
              {event.attendance === 'not_required'
                ? '无需参加'
                : event.attendance === 'optional'
                  ? '可选参加'
                  : event.attendance === 'required'
                    ? '需要参加'
                    : '参加情况待定'}
            </span>
            <span>rev {event.rev}</span>
          </div>
          {event.warnings.length > 0 && (
            <div className="event-dialog__warnings">
              {event.warnings.map((warning) => (
                <p key={warning}>
                  <Icon name="alert" size={13} />
                  {warning}
                </p>
              ))}
            </div>
          )}
        </div>
        <footer className="event-dialog__foot">
          <button className="text-button text-button--danger" onClick={() => onDelete(event)} type="button">
            <Icon name="trash" size={15} />
            移出时间轴
          </button>
          <span className="event-dialog__id">{event.id.slice(0, 16)}…</span>
        </footer>
      </div>
    </div>
  )
}
