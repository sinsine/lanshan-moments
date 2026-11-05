import { useEffect, useMemo, useState } from 'react'
import type {
  AppSettings,
  AttachedImage,
  ClarifyOption,
  ClarifyQuestion,
  DraftEvent,
  ScheduleDocument,
  ScheduleEvent,
} from './types'
import { addDays, dateKey, formatTime, startOfDay, weekdayCN } from './lib/date'
import { AUTHOR_URL, DEFAULT_GITHUB_CLIENT_ID, REPO_URL } from './lib/config'
import { checkLatestRelease, type UpdateInfo } from './lib/update'
import { openExternal } from './lib/native'
import { TopNav } from './components/TopNav'
import { WindowFrame } from './components/WindowFrame'
import { MobileWeekGrid } from './components/MobileWeekGrid'
import { TiledWorkspace } from './components/TiledWorkspace'
import { applyClarifyCustom, applyClarifyOption, missingRequiredFields } from './lib/clarify'
import { parseScheduleText } from './lib/parser'
import { friendlyAiError, parseWithAi } from './lib/ai'
import {
  copyText,
  downloadText,
  draftsToEvents,
  fileToAttachedImage,
  formatScheduleJson,
  getDeviceId,
  loadApiKey,
  loadEvents,
  loadGithubToken,
  loadSettings,
  makeScheduleDocument,
  saveApiKey,
  saveEvents,
  saveGithubToken,
  saveSettings,
} from './lib/storage'
import { mergeSchedules, syncGitHub } from './lib/sync'
import {
  clearNotifications,
  openExactAlarmSettings,
  refreshNotificationsIfEnabled,
  syncNotifications,
} from './lib/notifications'
import { CapturePanel } from './components/CapturePanel'
import { Timeline } from './components/Timeline'
import { WeekOverview } from './components/WeekOverview'
import { Inspector } from './components/Inspector'
import { SettingsDialog } from './components/SettingsDialog'
import { GitHubConnectDialog } from './components/GitHubConnectDialog'
import { EventDialog } from './components/EventDialog'
import { Icon } from './components/Icons'

type InspectorTab = 'drafts' | 'json'
type MobileSheet = 'capture' | 'review' | null
type ToastState = {
  message: string
  tone: 'default' | 'error'
  actionLabel?: string
  action?: () => void
} | null

const SAMPLE = [
  '本周五上午9点，周会（线上），大概一小时。',
  '本周日晚上7点，和小林在梧桐餐厅吃饭。',
  '下周三下午3点到4点半，产品评审，3楼会议室。',
  '还有，月底前把护照续签材料交了，具体时间没定。',
].join('\n')

function sortEvents(events: ScheduleEvent[]): ScheduleEvent[] {
  return [...events].sort((a, b) => {
    const aTime = a.start ? Date.parse(a.start) : Number.MAX_SAFE_INTEGER
    const bTime = b.start ? Date.parse(b.start) : Number.MAX_SAFE_INTEGER
    return aTime - bTime || a.title.localeCompare(b.title, 'zh-CN')
  })
}

function isMobile(): boolean {
  return window.matchMedia('(max-width: 980px)').matches
}

function initialWindowLayout() {
  const width = Math.max(980, window.innerWidth)
  const height = Math.max(640, window.innerHeight - 44)
  const gap = 8
  const left = Math.min(390, Math.max(330, width * 0.27))
  const middle = width - left - gap * 3
  const upper = (height - gap * 3) * 0.46
  const weekHeight = (height - gap * 3) * 0.38
  return {
    capture: { x: gap, y: gap, width: left, height: upper },
    inbox: { x: gap, y: gap * 2 + upper, width: left, height: height - upper - gap * 3 },
    week: { x: gap * 2 + left, y: gap, width: middle, height: weekHeight },
    timeline: {
      x: gap * 2 + left,
      y: gap * 2 + weekHeight,
      width: middle,
      height: height - weekHeight - gap * 3,
    },
    settings: {
      x: Math.max(24, (width - 780) / 2),
      y: Math.max(20, (height - 700) / 2),
      width: Math.min(780, width - 48),
      height: Math.min(720, height - 40),
    },
  }
}

function windowLabel(id: string): string {
  switch (id) {
    case 'timeline':
      return '时间轴'
    case 'week':
      return '周概览'
    case 'inbox':
      return '整理箱'
    case 'capture':
      return '添加日程'
    default:
      return '设置'
  }
}

export default function App() {
  const [deviceId] = useState(getDeviceId)
  const [events, setEvents] = useState<ScheduleEvent[]>(() => {
    const stored = loadEvents()
    if (!stored) return []
    // Earlier builds seeded fictional demo events. Do not keep showing them as
    // if they were the user's own schedule; keep every non-seed event intact.
    return stored.filter((event) => !event.id.startsWith('evt_seed_'))
  })
  const [settings, setSettings] = useState<AppSettings>(loadSettings)
  const [apiKey, setApiKey] = useState(loadApiKey)
  const [githubToken, setGithubToken] = useState(loadGithubToken)
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()))
  const [viewMode, setViewMode] = useState<'day' | 'week'>('week')
  const [panelVisible, setPanelVisible] = useState({
    timeline: true,
    week: true,
    inbox: true,
    capture: true,
  })
  const [windowZ, setWindowZ] = useState<Record<string, number>>({
    capture: 1,
    week: 2,
    timeline: 3,
    inbox: 4,
    settings: 5,
  })
  const [, setZCounter] = useState(6)
  const [layoutEpoch, setLayoutEpoch] = useState(0)
  const [nativeV3, setNativeV3] = useState(false)
  const [input, setInput] = useState('')
  const [image, setImage] = useState<AttachedImage | null>(null)
  const [drafts, setDrafts] = useState<DraftEvent[]>([])
  const [tab, setTab] = useState<InspectorTab>('drafts')
  const [parsing, setParsing] = useState(false)
  const [stage, setStage] = useState('正在拆解时间表达…')
  const [engineLabel, setEngineLabel] = useState('离线规则')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [githubDialogOpen, setGithubDialogOpen] = useState(false)
  const [updateDialog, setUpdateDialog] = useState<{
    checking: boolean
    info?: UpdateInfo
    error?: string
  } | null>(null)
  const [activeEventId, setActiveEventId] = useState<string | null>(null)
  const [mobileSheet, setMobileSheet] = useState<MobileSheet>(null)
  const [toast, setToast] = useState<ToastState>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null)
  const [notificationsOn, setNotificationsOn] = useState(
    () => localStorage.getItem('lanshan.notifications') === '1',
  )
  const [notificationStatus, setNotificationStatus] = useState('')

  const hasAiKey = apiKey.trim().length > 0
  const githubClientId =
    settings.githubClientId.trim() ||
    (import.meta.env.VITE_GITHUB_CLIENT_ID as string | undefined) ||
    DEFAULT_GITHUB_CLIENT_ID
  const syncConnected = Boolean(
    settings.githubOwner && settings.githubRepo && githubToken,
  )
  const activeEvent = events.find((event) => event.id === activeEventId) ?? null
  const selectedDrafts = drafts.filter((draft) => draft.selected)
  const previewEvents = selectedDrafts.map((draft) => {
    const { selected: _selected, questions: _questions, ...event } = draft
    void _selected
    void _questions
    return event
  })
  const scheduleDoc = useMemo(
    () => makeScheduleDocument(sortEvents([...events, ...previewEvents]), deviceId),
    [events, previewEvents, deviceId],
  )
  const liveEvents = useMemo(() => events.filter((event) => !event.deletedAt), [events])

  useEffect(() => {
    if (!notificationsOn) return
    let cancelled = false
    refreshNotificationsIfEnabled(liveEvents, true)
      .then((result) => {
        if (!cancelled && result) setNotificationStatus(result.message)
      })
      .catch(() => {
        if (!cancelled) setNotificationStatus('提醒刷新失败，请检查通知权限。')
      })
    return () => {
      cancelled = true
    }
  }, [liveEvents, notificationsOn])

  useEffect(() => {
    const onResize = () => setLayoutEpoch((epoch) => epoch + 1)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== 'lanshan.attach' || !event.newValue) return
      const panel = event.newValue
      setPanelVisible((current) => ({ ...current, [panel]: true }))
      localStorage.removeItem('lanshan.attach')
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  useEffect(() => {
    void fetch('/api/health')
      .then((response) => response.json())
      .then((payload: { native?: boolean }) => setNativeV3(Boolean(payload.native)))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const onStorageSync = (event: StorageEvent) => {
      if (event.key === 'lanshan.events.v1') {
        const next = loadEvents()
        if (next) setEvents(next)
      }
      if (event.key === 'lanshan.settings.v1') setSettings(loadSettings())
    }
    window.addEventListener('storage', onStorageSync)
    return () => window.removeEventListener('storage', onStorageSync)
  }, [])
  useEffect(() => {
    saveEvents(events)
  }, [events])

  useEffect(() => {
    saveSettings(settings)
    document.documentElement.dataset.theme = settings.theme
    document.documentElement.style.colorScheme = settings.theme
  }, [settings])

  useEffect(() => {
    if (!parsing) return
    const steps = hasAiKey
      ? ['正在读取这段线索…', '正在辨认日期与时间…', '正在拆成独立的时刻…', '正在检查模糊之处…']
      : ['正在拆解时间表达…', '正在补全日期…', '正在整理地点与时长…', '正在标记需要确认的部分…']
    let index = 1
    const timer = window.setInterval(() => {
      setStage(steps[Math.min(index, steps.length - 1)])
      index += 1
    }, 900)
    return () => window.clearInterval(timer)
  }, [parsing, hasAiKey])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 4200)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    const locked =
      settingsOpen || githubDialogOpen || Boolean(activeEvent) || mobileSheet !== null
    document.body.style.overflow = locked ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [settingsOpen, githubDialogOpen, activeEvent, mobileSheet])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const editing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.getAttribute('contenteditable') === 'true'
      if (event.key === 'Escape') {
        setSettingsOpen(false)
        setGithubDialogOpen(false)
        setActiveEventId(null)
        setMobileSheet(null)
        return
      }
      if (event.key.toLowerCase() === 'n' && !editing && !event.metaKey && !event.ctrlKey) {
        event.preventDefault()
        if (isMobile()) setMobileSheet('capture')
        else
          document
            .querySelector<HTMLTextAreaElement>('.capture:not(.capture--compact) textarea')
            ?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const notify = (
    message: string,
    options: { tone?: 'default' | 'error'; actionLabel?: string; action?: () => void } = {},
  ) => {
    setToast({
      message,
      tone: options.tone ?? 'default',
      actionLabel: options.actionLabel,
      action: options.action,
    })
  }

  const handleSample = () => {
    setInput(SAMPLE)
    if (isMobile()) setMobileSheet('capture')
    window.setTimeout(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>(
        isMobile() ? '.capture--compact textarea' : '.capture:not(.capture--compact) textarea',
      )
      textarea?.focus()
      textarea?.setSelectionRange(0, 0)
      if (textarea) textarea.scrollTop = 0
    }, 80)
  }

  const handleImage = async (file: File) => {
    try {
      const attached = await fileToAttachedImage(file)
      setImage(attached)
      notify('图片已附上。配好视觉模型后，它会一起被读取。')
    } catch (error) {
      notify(error instanceof Error ? error.message : '图片读取失败', { tone: 'error' })
    }
  }

  const handleParse = async () => {
    if (parsing || (!input.trim() && !image)) return
    if (image && !hasAiKey && !input.trim()) {
      notify('图片识别需要先在设置里配置支持视觉的模型', { tone: 'error' })
      setSettingsOpen(true)
      return
    }
    setStage(hasAiKey ? '正在读取这段线索…' : '正在拆解时间表达…')
    setParsing(true)
    setTab('drafts')
    if (isMobile()) setMobileSheet('review')
    const startedAt = Date.now()

    const fallbackToLocal = (reason?: string) => {
      const local = parseScheduleText(input, new Date(), deviceId)
      if (local.length === 0) {
        throw new Error(reason ?? '没有识别到明确的日期或时间，请再给一点线索')
      }
      setDrafts(local)
      setEngineLabel('离线规则')
      const first = local.find((draft) => draft.start)
      if (first?.start) setSelectedDate(startOfDay(new Date(first.start)))
      if (reason) notify(`AI 不可用，已改用离线规则：${reason}`, { tone: 'error' })
      else notify(`读出了 ${local.length} 个时刻，确认后再写入时间轴`)
    }

    try {
      if (hasAiKey) {
        try {
          const result = await parseWithAi(
            input,
            image,
            { baseUrl: settings.baseUrl, model: settings.model, apiKey },
            deviceId,
          )
          setDrafts(result.drafts)
          setEngineLabel(`AI · ${result.model}`)
          const first = result.drafts.find((draft) => draft.start)
          if (first?.start) setSelectedDate(startOfDay(new Date(first.start)))
          notify(`读出了 ${result.drafts.length} 个时刻，请过目`)
        } catch (error) {
          if (input.trim()) {
            fallbackToLocal(friendlyAiError(error))
          } else {
            throw error
          }
        }
      } else {
        await new Promise((resolve) => window.setTimeout(resolve, 520))
        fallbackToLocal()
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : '整理失败，请再试一次', { tone: 'error' })
    } finally {
      const elapsed = Date.now() - startedAt
      if (elapsed < 650) await new Promise((resolve) => window.setTimeout(resolve, 650 - elapsed))
      setParsing(false)
    }
  }

  const handleToggleDraft = (id: string) => {
    setDrafts((current) =>
      current.map((draft) => (draft.id === id ? { ...draft, selected: !draft.selected } : draft)),
    )
  }

  const handleSelectAll = (selected: boolean) => {
    setDrafts((current) => current.map((draft) => ({ ...draft, selected })))
  }

  const handleAnswerOption = (
    draft: DraftEvent,
    question: ClarifyQuestion,
    option: ClarifyOption,
  ) => {
    const result = applyClarifyOption(draft, question, option)
    if (result.error) {
      notify(result.error, { tone: 'error' })
      return
    }
    setDrafts((current) => current.map((item) => (item.id === draft.id ? result.draft : item)))
  }

  const handleAnswerCustom = (draft: DraftEvent, question: ClarifyQuestion, text: string) => {
    const result = applyClarifyCustom(draft, question, text)
    if (result.error) {
      notify(result.error, { tone: 'error' })
      return
    }
    setDrafts((current) => current.map((item) => (item.id === draft.id ? result.draft : item)))
  }

  const handleConfirm = () => {
    const selected = drafts.filter((draft) => draft.selected)
    if (selected.length === 0) return
    const invalid = selected.filter((draft) => missingRequiredFields(draft).length > 0)
    if (invalid.length > 0) {
      notify(
        `还有 ${invalid.length} 条缺少开始/结束/地点，先回答右侧的问题或勾选“待定”`,
        { tone: 'error' },
      )
      setTab('drafts')
      return
    }
    const chosen = draftsToEvents(drafts)
    if (chosen.length === 0) return
    const previous = events
    const next = sortEvents([...events, ...chosen])
    setEvents(next)
    setDrafts([])
    setTab('drafts')
    setMobileSheet(null)
    const first = chosen.find((event) => event.start)
    if (first?.start) setSelectedDate(startOfDay(new Date(first.start)))
    notify(`已写入 ${chosen.length} 个时刻`, {
      actionLabel: '撤销',
      action: () => {
        setEvents(previous)
        setToast(null)
      },
    })
  }

  const handleDeleteEvent = (event: ScheduleEvent) => {
    const previous = events
    const timestamp = new Date().toISOString()
    setEvents((current) =>
      current.map((item) =>
        item.id === event.id
          ? { ...item, deletedAt: timestamp, updatedAt: timestamp, rev: item.rev + 1 }
          : item,
      ),
    )
    setActiveEventId(null)
    notify(`“${event.title}”已移出时间轴`, {
      actionLabel: '撤销',
      action: () => {
        setEvents(previous)
        setToast(null)
      },
    })
  }

  const openGithubConnect = () => {
    setSettingsOpen(false)
    setGithubDialogOpen(true)
  }

  const detachPanel = (id: string) => {
    void fetch(`/api/detach?panel=${encodeURIComponent(id)}`)
      .then((response) => {
        if (!response.ok) throw new Error(`native bridge ${response.status}`)
        setPanelVisible((current) => ({ ...current, [id]: false }))
      })
      .catch(() => notify('独立窗口仅支持 Wails v3 桌面壳', { tone: 'error' }))
  }
  const bringWindowToFront = (id: string) => {
    setZCounter((current) => {
      const next = current + 1
      setWindowZ((z) => ({ ...z, [id]: next }))
      return next
    })
  }

  const toggleWindow = (id: string) => {
    if (id === 'settings') {
      if (!settingsOpen) bringWindowToFront('settings')
      setSettingsOpen((current) => !current)
      return
    }
    const next = !panelVisible[id as keyof typeof panelVisible]
    if (next) bringWindowToFront(id)
    setPanelVisible((current) => ({ ...current, [id]: next }))
  }

  const runEditAction = async (
    action: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'delete' | 'selectAll',
  ) => {
    const element = document.activeElement as
      | HTMLInputElement
      | HTMLTextAreaElement
      | null
    const editable =
      element &&
      (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA')
    if (!editable) {
      if (action === 'copy') {
        const selected = window.getSelection()?.toString() ?? ''
        if (selected) {
          await navigator.clipboard.writeText(selected).catch(() => undefined)
          notify('已复制选中文字')
        } else {
          notify('请先在输入框或正文中选中文字')
        }
      } else {
        notify('请先把光标放进输入框')
      }
      return
    }
    if (action === 'paste') {
      try {
        const text = await navigator.clipboard.readText()
        const start = element.selectionStart ?? element.value.length
        const end = element.selectionEnd ?? start
        element.setRangeText(text, start, end, 'end')
        element.dispatchEvent(new Event('input', { bubbles: true }))
      } catch {
        notify('浏览器不允许读取剪贴板，请用 Ctrl+V', { tone: 'error' })
      }
      return
    }
    const commandMap = {
      undo: 'undo',
      redo: 'redo',
      cut: 'cut',
      copy: 'copy',
      delete: 'delete',
      selectAll: 'selectAll',
    } as const
    const ok = document.execCommand(commandMap[action])
    if (!ok && action !== 'copy') notify('这个编辑命令当前不可用', { tone: 'error' })
  }

  const handleCheckUpdates = async () => {
    setUpdateDialog({ checking: true })
    try {
      const info = await checkLatestRelease()
      setUpdateDialog({ checking: false, info })
    } catch (error) {
      setUpdateDialog({
        checking: false,
        error: error instanceof Error ? error.message : '检查更新失败',
      })
    }
  }

  const nativeBridge = (
    window as unknown as {
      go?: {
        main?: {
          App?: {
            Quit?: () => void
            WindowMinimise?: () => void
            WindowToggleMaximise?: () => void
          }
        }
      }
    }
  ).go?.main?.App

  const handleExit = () => {
    if (nativeBridge?.Quit) {
      nativeBridge.Quit()
      return
    }
    window.close()
    window.setTimeout(() => {
      if (!window.closed) notify('浏览器不允许直接退出，请关闭标签页')
    }, 300)
  }

  const handleToggleNotifications = async () => {
    if (notificationsOn) {
      await clearNotifications().catch(() => undefined)
      setNotificationsOn(false)
      localStorage.setItem('lanshan.notifications', '0')
      setNotificationStatus('已关闭本机提醒。')
      notify('已关闭本机提醒')
      return
    }
    try {
      const result = await syncNotifications(liveEvents)
      setNotificationStatus(result.message)
      if (!result.supported) {
        notify('通知只在 Android / iOS 原生端可用；当前是网页版', { tone: 'error' })
        return
      }
      if (!result.granted) {
        notify(result.message, { tone: 'error' })
        return
      }
      setNotificationsOn(true)
      localStorage.setItem('lanshan.notifications', '1')
      notify(result.message)
    } catch (error) {
      notify(error instanceof Error ? error.message : '开启提醒失败', { tone: 'error' })
    }
  }

  const handleOpenExactAlarm = async () => {
    try {
      await openExactAlarmSettings()
    } catch {
      notify('无法打开精确闹钟设置，请到系统设置中手动授权', { tone: 'error' })
    }
  }

  const handleSaveSettings = (next: AppSettings, nextApiKey: string, nextGithubToken: string) => {
    setSettings(next)
    setApiKey(nextApiKey)
    setGithubToken(nextGithubToken)
    saveApiKey(nextApiKey)
    saveGithubToken(nextGithubToken)
    notify('设置已保存在这台设备上')
  }

  const handleSync = async (syncSettings = settings, token = githubToken) => {
    if (!syncSettings.githubOwner || !syncSettings.githubRepo || !token) {
      notify('请先填写 GitHub 用户名、私有仓库和 Token', { tone: 'error' })
      setSettingsOpen(true)
      return
    }
    setSyncing(true)
    setSyncMessage('正在读取云端…')
    try {
      const result = await syncGitHub(
        {
          owner: syncSettings.githubOwner,
          repo: syncSettings.githubRepo,
          branch: syncSettings.githubBranch || 'main',
          token,
        },
        makeScheduleDocument(events, deviceId),
      )
      setEvents(sortEvents(result.document.events))
      setLastSyncAt(new Date())
      const text =
        result.mode === 'created'
          ? '已创建云端 schedule.json'
          : result.mode === 'unchanged'
            ? '云端与本地已经一致'
            : `已合并：拉取 ${result.pulled} 条，推送 ${result.pushed} 条变更`
      setSyncMessage(text)
      notify(text)
    } catch (error) {
      const message = error instanceof Error ? error.message : '同步失败'
      setSyncMessage(message)
      notify(message, { tone: 'error' })
    } finally {
      setSyncing(false)
    }
  }

  const handleGithubConnected = (payload: {
    token: string
    login: string
    avatarUrl: string
    owner: string
    repo: string
    branch: string
  }) => {
    const next: AppSettings = {
      ...settings,
      githubOwner: payload.owner,
      githubRepo: payload.repo,
      githubBranch: payload.branch,
    }
    setSettings(next)
    saveSettings(next)
    setGithubToken(payload.token)
    saveGithubToken(payload.token)
    setGithubDialogOpen(false)
    notify(`已连接 @${payload.login}，开始同步 ${payload.repo}`)
    void handleSync(next, payload.token)
  }

  const handleExport = () => {
    downloadText(`lanshan-schedule-${dateKey(new Date())}.json`, formatScheduleJson(scheduleDoc))
    notify('schedule.json 已导出')
  }

  const handleImport = async (file: File) => {
    try {
      const text = await file.text()
      const imported = JSON.parse(text) as ScheduleDocument
      if (!imported || !Array.isArray(imported.events)) {
        throw new Error('文件里没有 events 数组')
      }
      const merged = mergeSchedules(makeScheduleDocument(events, deviceId), {
        schemaVersion: '1.0',
        timezone: imported.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
        updatedAt: imported.updatedAt ?? new Date().toISOString(),
        deviceId: imported.deviceId ?? 'imported',
        events: imported.events
          .filter((event) => event && typeof event.id === 'string')
          .map((event) => ({
            ...event,
            location: event.location ?? '',
            attendance: event.attendance ?? 'unknown',
          })),
      })
      setEvents(sortEvents(merged.document.events))
      setSettingsOpen(false)
      notify(`已导入并合并 ${merged.changed} 条变更`)
    } catch (error) {
      notify(error instanceof Error ? error.message : '导入失败', { tone: 'error' })
    }
  }

  const handleClear = () => {
    setEvents([])
    setDrafts([])
    setSettingsOpen(false)
    notify('这台设备上的日程已清空')
  }

  const handleCopyJson = async () => {
    try {
      await copyText(formatScheduleJson(scheduleDoc))
      notify('JSON 已复制')
    } catch {
      notify('复制失败，请手动选择文本', { tone: 'error' })
    }
  }

  const shiftWeek = (direction: -1 | 1) => {
    setSelectedDate((current) => addDays(current, direction * 7))
  }

  const syncLabel = syncing
    ? '同步中'
    : lastSyncAt
      ? `已同步 ${formatTime(lastSyncAt.toISOString())}`
      : syncConnected
        ? '已连接'
        : '仅本地'

  const captureProps = {
    value: input,
    onChange: setInput,
    image,
    onImage: handleImage,
    onRemoveImage: () => setImage(null),
    onParse: handleParse,
    onSample: handleSample,
    parsing,
    stage,
    hasAiKey,
    model: settings.model,
    onOpenSettings: () => setSettingsOpen(true),
  }

  const detachedPanel = new URLSearchParams(window.location.search).get('panel')
  const layout = initialWindowLayout()
  const topNavWindows = [
    { id: 'timeline' as const, label: windowLabel('timeline'), visible: panelVisible.timeline },
    { id: 'week' as const, label: windowLabel('week'), visible: panelVisible.week },
    { id: 'inbox' as const, label: windowLabel('inbox'), visible: panelVisible.inbox },
    { id: 'capture' as const, label: windowLabel('capture'), visible: panelVisible.capture },
    { id: 'settings' as const, label: windowLabel('settings'), visible: settingsOpen },
  ]

  const openCapture = () => {
    if (isMobile()) {
      setMobileSheet('capture')
      return
    }
    setPanelVisible((current) => ({ ...current, capture: true }))
    window.setTimeout(() => {
      document
        .querySelector<HTMLTextAreaElement>('.window-frame .capture textarea')
        ?.focus()
    }, 60)
  }

  const toggleTheme = () => {
    const nextTheme: AppSettings['theme'] = settings.theme === 'dark' ? 'light' : 'dark'
    const next = { ...settings, theme: nextTheme }
    setSettings(next)
    saveSettings(next)
  }

  if (detachedPanel) {
    const closeDetached = () => {
      localStorage.setItem('lanshan.attach', detachedPanel)
      void fetch(`/api/attach?panel=${encodeURIComponent(detachedPanel)}`).catch(() => undefined)
      window.close()
    }
    const content =
      detachedPanel === 'week' ? (
        <WeekOverview
          events={liveEvents}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
          onShiftWeek={shiftWeek}
          onToday={() => setSelectedDate(startOfDay(new Date()))}
          onEventClick={(event) => setActiveEventId(event.id)}
          onOpenDay={(date) => {
            setSelectedDate(date)
            setViewMode('day')
          }}
          onSync={() => handleSync()}
          onOpenSettings={openGithubConnect}
          syncLabel={syncLabel}
          syncConnected={syncConnected}
          syncing={syncing}
        />
      ) : detachedPanel === 'timeline' ? (
        <Timeline
          events={liveEvents}
          drafts={drafts}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
          onShiftWeek={shiftWeek}
          onToday={() => setSelectedDate(startOfDay(new Date()))}
          onAdd={openCapture}
          onEventClick={(event) => setActiveEventId(event.id)}
          onSync={() => handleSync()}
          onOpenSettings={openGithubConnect}
          syncLabel={syncLabel}
          syncConnected={syncConnected}
          syncing={syncing}
        />
      ) : detachedPanel === 'inbox' ? (
        <Inspector
          drafts={drafts}
          document={scheduleDoc}
          tab={tab}
          onTab={setTab}
          onToggle={handleToggleDraft}
          onSelectAll={handleSelectAll}
          onAnswerOption={handleAnswerOption}
          onAnswerCustom={handleAnswerCustom}
          onConfirm={handleConfirm}
          onCopy={handleCopyJson}
          onDownload={handleExport}
          parsing={parsing}
          stage={stage}
          engineLabel={engineLabel}
        />
      ) : (
        <CapturePanel {...captureProps} />
      )
    return (
      <div className="detached-shell">
        <header className="detached-head">
          <span>{windowLabel(detachedPanel)}</span>
          <button type="button" onClick={closeDetached} aria-label="关闭独立窗口">
            <Icon name="x" size={14} />
          </button>
        </header>
        <div className="detached-content">{content}</div>
      </div>
    )
  }

  return (
    <div className="app-shell app-shell--v3">
      <div className="liquid-bg" aria-hidden="true">
        <span className="blob blob-1" />
        <span className="blob blob-2" />
        <span className="blob blob-3" />
      </div>

      <div className="desktop-shell">
        <TopNav
          windows={topNavWindows}
          onToggleWindow={toggleWindow}
          onOpenAbout={() => void openExternal(REPO_URL)}
          onOpenAuthor={() => void openExternal(AUTHOR_URL)}
          onCheckUpdates={() => void handleCheckUpdates()}
          onExit={handleExit}
          onEditAction={(action) => void runEditAction(action)}
          syncLabel={syncLabel}
          syncConnected={syncConnected}
          syncing={syncing}
          onSync={() => void handleSync()}
          onOpenSyncSettings={openGithubConnect}
          theme={settings.theme}
          onToggleTheme={toggleTheme}
          nativeWindow={Boolean(nativeBridge) || nativeV3}
          onMinimize={() => {
            if (nativeV3) void fetch('/api/window/minimize')
            else nativeBridge?.WindowMinimise?.()
          }}
          onMaximize={() => {
            if (nativeV3) void fetch('/api/window/maximize')
            else nativeBridge?.WindowToggleMaximise?.()
          }}
          onCloseWindow={() => {
            if (nativeV3) void fetch('/api/window/close')
            else handleExit()
          }}
        />

        <div className="window-workspace">
          <TiledWorkspace
            panels={[
              ...(panelVisible.capture
                ? [{ id: 'capture' as const, title: '添加日程', icon: <Icon name="plus" size={14} />, content: <CapturePanel {...captureProps} /> }]
                : []),
              ...(panelVisible.inbox
                ? [{
                    id: 'inbox' as const,
                    title: '整理箱',
                    icon: <Icon name="inbox" size={14} />,
                    content: (
                      <Inspector
                        drafts={drafts}
                        document={scheduleDoc}
                        tab={tab}
                        onTab={setTab}
                        onToggle={handleToggleDraft}
                        onSelectAll={handleSelectAll}
                        onAnswerOption={handleAnswerOption}
                        onAnswerCustom={handleAnswerCustom}
                        onConfirm={handleConfirm}
                        onCopy={handleCopyJson}
                        onDownload={handleExport}
                        parsing={parsing}
                        stage={stage}
                        engineLabel={engineLabel}
                      />
                    ),
                  }]
                : []),
              ...(panelVisible.week
                ? [{
                    id: 'week' as const,
                    title: '周概览',
                    icon: <Icon name="grid" size={14} />,
                    content: (
                      <WeekOverview
                        events={liveEvents}
                        selectedDate={selectedDate}
                        onSelectDate={setSelectedDate}
                        onShiftWeek={shiftWeek}
                        onToday={() => setSelectedDate(startOfDay(new Date()))}
                        onEventClick={(event) => setActiveEventId(event.id)}
                        onOpenDay={(date) => { setSelectedDate(date); setViewMode('day') }}
                        onSync={() => handleSync()}
                        onOpenSettings={openGithubConnect}
                        syncLabel={syncLabel}
                        syncConnected={syncConnected}
                        syncing={syncing}
                      />
                    ),
                  }]
                : []),
              ...(panelVisible.timeline
                ? [{
                    id: 'timeline' as const,
                    title: '时间轴',
                    icon: <Icon name="calendar" size={14} />,
                    content: (
                      <Timeline
                        events={liveEvents}
                        drafts={drafts}
                        selectedDate={selectedDate}
                        onSelectDate={setSelectedDate}
                        onShiftWeek={shiftWeek}
                        onToday={() => setSelectedDate(startOfDay(new Date()))}
                        onAdd={openCapture}
                        onEventClick={(event) => setActiveEventId(event.id)}
                        onSync={() => handleSync()}
                        onOpenSettings={openGithubConnect}
                        syncLabel={syncLabel}
                        syncConnected={syncConnected}
                        syncing={syncing}
                      />
                    ),
                  }]
                : []),
            ]}
            onClose={(id) => setPanelVisible((current) => ({ ...current, [id]: false }))}
            onDetach={(id) => detachPanel(id)}
            onFocus={(id) => bringWindowToFront(id)}
          />
          {settingsOpen && (
            <WindowFrame
              key={`settings-${layoutEpoch}`}
              id="settings"
              title="设置"
              icon={<Icon name="settings" size={15} />}
              initial={layout.settings}
              zIndex={windowZ.settings}
              floating
              onFocus={() => bringWindowToFront('settings')}
              onClose={() => setSettingsOpen(false)}
            >
              <SettingsDialog
                embedded
                settings={settings}
                apiKey={apiKey}
                githubToken={githubToken}
                syncBusy={syncing}
                syncMessage={syncMessage}
                onClose={() => setSettingsOpen(false)}
                onSave={handleSaveSettings}
                onSync={(nextSettings, token) => {
                  saveGithubToken(token)
                  handleSync(nextSettings, token)
                }}
                onExport={handleExport}
                onImport={handleImport}
                onClear={handleClear}
                onOpenConnect={openGithubConnect}
                notificationsOn={notificationsOn}
                notificationStatus={notificationStatus}
                onToggleNotifications={handleToggleNotifications}
                onOpenExactAlarm={handleOpenExactAlarm}
              />
            </WindowFrame>
          )}
        </div>
      </div>

      <div className={`mobile-shell mobile-shell--${viewMode}`}>
        {viewMode === 'week' ? (
          <MobileWeekGrid
            events={liveEvents}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            onShiftWeek={shiftWeek}
            onOpenDay={(date) => {
              setSelectedDate(date)
              setViewMode('day')
            }}
            onEventClick={(event) => setActiveEventId(event.id)}
            onAdd={() => setMobileSheet('capture')}
          />
        ) : (
          <>
            <header className="mobile-head mobile-head--v3">
              <button
                className="mobile-head__plus"
                onClick={() => setMobileSheet('capture')}
                aria-label="添加日程"
                type="button"
              >
                <Icon name="plus" size={22} />
              </button>
              <button
                className="mobile-head__title"
                onClick={() => setViewMode('week')}
                type="button"
              >
                <span>
                  {selectedDate.getMonth() + 1}月{selectedDate.getDate()}日{' '}
                  {weekdayCN(selectedDate)}
                </span>
                <Icon name="chevron-down" size={14} />
              </button>
              <div className="mobile-head__actions">
                <button
                  className="icon-button"
                  onClick={() => {
                    setTab('drafts')
                    setMobileSheet('review')
                  }}
                  aria-label="整理箱"
                  type="button"
                >
                  <span className="mobile-nav__icon-wrap">
                    <Icon name="inbox" size={18} />
                    {drafts.length > 0 && <i>{drafts.length}</i>}
                  </span>
                </button>
                <button
                  className={`icon-button ${syncConnected ? 'is-synced' : ''}`}
                  onClick={() => (syncConnected ? handleSync() : openGithubConnect())}
                  aria-label="同步"
                  type="button"
                >
                  <Icon name={syncConnected ? 'cloud' : 'cloud-off'} size={18} />
                </button>
              </div>
            </header>

            <Timeline
              events={liveEvents}
              drafts={drafts}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
              onShiftWeek={shiftWeek}
              onToday={() => setSelectedDate(startOfDay(new Date()))}
              onAdd={() => setMobileSheet('capture')}
              onEventClick={(event) => setActiveEventId(event.id)}
              onSync={() => handleSync()}
              onOpenSettings={openGithubConnect}
              syncLabel={syncLabel}
              syncConnected={syncConnected}
              syncing={syncing}
            />
          </>
        )}

        <button
          className="mobile-inbox-fab"
          type="button"
          onClick={() => {
            setTab('drafts')
            setMobileSheet('review')
          }}
          aria-label="打开整理箱"
        >
          <Icon name="inbox" size={17} />
          {drafts.length > 0 && <i>{drafts.length}</i>}
        </button>

        <nav className="mobile-nav mobile-nav--three" aria-label="移动端导航">
          <button
            className={viewMode === 'week' ? 'is-active' : ''}
            type="button"
            onClick={() => setViewMode('week')}
          >
            <Icon name="grid" size={19} />
            <span>周表</span>
          </button>
          <button
            className={viewMode === 'day' ? 'is-active' : ''}
            type="button"
            onClick={() => setViewMode('day')}
          >
            <Icon name="calendar" size={19} />
            <span>时间轴</span>
          </button>
          <button type="button" onClick={() => setSettingsOpen(true)}>
            <Icon name="settings" size={19} />
            <span>我的</span>
          </button>
        </nav>
      </div>

      {mobileSheet === 'capture' && (
        <div className="sheet-backdrop" onMouseDown={() => setMobileSheet(null)}>
          <div className="mobile-sheet" onMouseDown={(event) => event.stopPropagation()}>
            <div className="mobile-sheet__grab" />
            <button
              className="icon-button mobile-sheet__close"
              onClick={() => setMobileSheet(null)}
              aria-label="关闭"
              type="button"
            >
              <Icon name="x" size={18} />
            </button>
            <CapturePanel {...captureProps} compact />
          </div>
        </div>
      )}

      {mobileSheet === 'review' && (
        <div className="sheet-backdrop" onMouseDown={() => setMobileSheet(null)}>
          <div
            className="mobile-sheet mobile-sheet--review"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="mobile-sheet__grab" />
            <Inspector
              drafts={drafts}
              document={scheduleDoc}
              tab={tab}
              onTab={setTab}
              onToggle={handleToggleDraft}
              onSelectAll={handleSelectAll}
              onAnswerOption={handleAnswerOption}
              onAnswerCustom={handleAnswerCustom}
              onConfirm={handleConfirm}
              onCopy={handleCopyJson}
              onDownload={handleExport}
              parsing={parsing}
              stage={stage}
              engineLabel={engineLabel}
              onClose={() => setMobileSheet(null)}
            />
          </div>
        </div>
      )}

      {settingsOpen && isMobile() && (
        <SettingsDialog
          settings={settings}
          apiKey={apiKey}
          githubToken={githubToken}
          syncBusy={syncing}
          syncMessage={syncMessage}
          onClose={() => setSettingsOpen(false)}
          onSave={handleSaveSettings}
          onSync={(nextSettings, token) => {
            saveGithubToken(token)
            handleSync(nextSettings, token)
          }}
          onExport={handleExport}
          onImport={handleImport}
          onClear={handleClear}
          onOpenConnect={openGithubConnect}
          notificationsOn={notificationsOn}
          notificationStatus={notificationStatus}
          onToggleNotifications={handleToggleNotifications}
          onOpenExactAlarm={handleOpenExactAlarm}
        />
      )}

      {updateDialog && (
        <div
          className="modal-backdrop"
          onMouseDown={() => {
            if (!updateDialog.checking) setUpdateDialog(null)
          }}
        >
          <div
            className="update-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="检查更新"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="update-dialog__head">
              <div>
                <p className="eyebrow">检查更新</p>
                <h2>阑珊时刻</h2>
              </div>
              <button
                className="icon-button"
                onClick={() => setUpdateDialog(null)}
                aria-label="关闭"
                type="button"
              >
                <Icon name="x" size={18} />
              </button>
            </header>
            <div className="update-dialog__body">
              {updateDialog.checking && <p>正在读取 GitHub Releases…</p>}
              {updateDialog.error && <p className="model-error">{updateDialog.error}</p>}
              {updateDialog.info && (
                <>
                  <p>
                    当前版本 <strong>v{updateDialog.info.current}</strong>
                  </p>
                  <p>
                    最新版本 <strong>v{updateDialog.info.latest}</strong>
                  </p>
                  <p className="update-dialog__hint">
                    {updateDialog.info.isNewer
                      ? '发现新版本。下载新安装包后覆盖安装即可，本地日程不会被清空。'
                      : '已经是最新版本。'}
                  </p>
                </>
              )}
            </div>
            <footer className="update-dialog__foot">
              <button className="text-button" type="button" onClick={() => setUpdateDialog(null)}>
                关闭
              </button>
              {updateDialog.info?.isNewer && (
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => {
                    void openExternal(updateDialog.info!.url)
                  }}
                >
                  打开下载页
                </button>
              )}
            </footer>
          </div>
        </div>
      )}

      {githubDialogOpen && (
        <GitHubConnectDialog
          clientId={githubClientId}
          initialToken={githubToken || undefined}
          onClose={() => setGithubDialogOpen(false)}
          onConnected={handleGithubConnected}
        />
      )}

      {activeEvent && (
        <EventDialog
          event={activeEvent}
          onClose={() => setActiveEventId(null)}
          onDelete={handleDeleteEvent}
        />
      )}

      {toast && (
        <div className={`toast ${toast.tone === 'error' ? 'toast--error' : ''}`} role="status">
          <span className="toast__icon">
            <Icon name={toast.tone === 'error' ? 'alert' : 'check'} size={14} />
          </span>
          <span>{toast.message}</span>
          {toast.actionLabel && toast.action && (
            <button
              onClick={() => {
                toast.action?.()
              }}
              type="button"
            >
              {toast.actionLabel}
            </button>
          )}
          <button
            className="toast__close"
            onClick={() => setToast(null)}
            aria-label="关闭提示"
            type="button"
          >
            <Icon name="x" size={13} />
          </button>
        </div>
      )}
    </div>
  )
}









