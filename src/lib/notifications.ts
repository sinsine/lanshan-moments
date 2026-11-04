import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import type { ScheduleEvent } from '../types'

export type NotificationResult = {
  supported: boolean
  granted: boolean
  scheduled: number
  exact: 'granted' | 'denied' | 'unknown'
  message: string
}

function isMobileNative(): boolean {
  return Capacitor.isNativePlatform() && ['android', 'ios'].includes(Capacitor.getPlatform())
}

function notificationId(event: ScheduleEvent): number {
  let hash = 0
  for (let index = 0; index < event.id.length; index += 1) {
    hash = (hash * 31 + event.id.charCodeAt(index)) | 0
  }
  return Math.abs(hash) || 1
}

function timeLabel(event: ScheduleEvent): string {
  if (!event.start) return '时间待定'
  const start = new Date(event.start)
  const end = event.end ? new Date(event.end) : null
  const clock = (date: Date) =>
    `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  return end ? `${clock(start)}–${clock(end)}` : clock(start)
}

export async function checkExactAlarm(): Promise<'granted' | 'denied' | 'unknown'> {
  if (!isMobileNative()) return 'unknown'
  const plugin = LocalNotifications as unknown as {
    checkExactNotificationSetting?: () => Promise<{ exact_alarm?: string }>
  }
  if (!plugin.checkExactNotificationSetting) return 'unknown'
  try {
    const result = await plugin.checkExactNotificationSetting()
    return result.exact_alarm === 'granted' ? 'granted' : 'denied'
  } catch {
    return 'unknown'
  }
}

export async function openExactAlarmSettings(): Promise<void> {
  if (!isMobileNative()) return
  const plugin = LocalNotifications as unknown as {
    changeExactNotificationSetting?: () => Promise<void>
  }
  await plugin.changeExactNotificationSetting?.()
}

export async function syncNotifications(events: ScheduleEvent[]): Promise<NotificationResult> {
  if (!isMobileNative()) {
    return {
      supported: false,
      granted: false,
      scheduled: 0,
      exact: 'unknown',
      message: '通知只在 Android / iOS 原生端可用。',
    }
  }

  const permission = await LocalNotifications.requestPermissions()
  const granted = permission.display === 'granted'
  if (!granted) {
    return {
      supported: true,
      granted: false,
      scheduled: 0,
      exact: await checkExactAlarm(),
      message: '通知权限未开启，请到系统设置里允许通知。',
    }
  }

  try {
    await LocalNotifications.createChannel({
      id: 'lanshan-reminders',
      name: '日程提醒',
      description: '在日程开始前提醒你',
      importance: 4,
      visibility: 1,
      vibration: true,
    })
  } catch {
    // Channel creation is idempotent on Android; iOS has no channels.
  }

  const pending = await LocalNotifications.getPending()
  if (pending.notifications.length > 0) {
    await LocalNotifications.cancel({
      notifications: pending.notifications.map((item) => ({ id: item.id })),
    })
  }

  const now = Date.now()
  const horizon = now + 30 * 24 * 60 * 60 * 1000
  const notifications = events
    .filter((event) => !event.deletedAt && event.start && !event.allDay)
    .map((event) => {
      const start = new Date(event.start!)
      const fireAt = new Date(start.getTime() - 10 * 60_000)
      if (start.getTime() < now || start.getTime() > horizon) return null
      if (fireAt.getTime() < now) fireAt.setTime(now + 3000)
      return {
        id: notificationId(event),
        title: event.title,
        body: `${timeLabel(event)}${event.location ? ` · ${event.location}` : ''}`,
        channelId: 'lanshan-reminders',
        schedule: { at: fireAt, allowWhileIdle: true },
        extra: { eventId: event.id },
      }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))

  if (notifications.length > 0) {
    await LocalNotifications.schedule({ notifications })
  }

  const exact = await checkExactAlarm()
  return {
    supported: true,
    granted: true,
    scheduled: notifications.length,
    exact,
    message:
      exact === 'denied'
        ? `已安排 ${notifications.length} 条提醒；精确闹钟未授权，系统可能延迟。`
        : `已安排 ${notifications.length} 条提醒。`,
  }
}

export async function clearNotifications(): Promise<void> {
  if (!isMobileNative()) return
  const pending = await LocalNotifications.getPending()
  if (pending.notifications.length > 0) {
    await LocalNotifications.cancel({
      notifications: pending.notifications.map((item) => ({ id: item.id })),
    })
  }
}

/** Called at startup only when the user previously enabled reminders. */
export async function refreshNotificationsIfEnabled(
  events: ScheduleEvent[],
  enabled: boolean,
): Promise<NotificationResult | null> {
  if (!enabled || !isMobileNative()) return null
  return syncNotifications(events)
}
