import { useEffect, useMemo, useState } from 'react'
import type {
  AppSettings,
  AttachedImage,
  DraftEvent,
  ScheduleDocument,
  ScheduleEvent,
} from './types'
import { addDays, dateKey, formatTime, startOfDay } from './lib/date'
import { parseScheduleText } from './lib/parser'
import { friendlyAiError, parseWithAi } from './lib/ai'
import {
  copyText,
  createSeedEvents,
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
import { CapturePanel } from './components/CapturePanel'
import { Timeline } from './components/Timeline'
import { Inspector } from './components/Inspector'
import { SettingsDialog } from './components/SettingsDialog'
import { EventDialog } from './components/EventDialog'
import { Icon, LogoMark } from './components/Icons'

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

export default function App() {
  const [deviceId] = useState(getDeviceId)
  const [events, setEvents] = useState<ScheduleEvent[]>(() => {
    const stored = loadEvents()
    return stored ?? createSeedEvents(new Date(), getDeviceId())
  })
  const [settings, setSettings] = useState<AppSettings>(loadSettings)
  const [apiKey, setApiKey] = useState(loadApiKey)
  const [githubToken, setGithubToken] = useState(loadGithubToken)
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()))
  const [input, setInput] = useState('')
  const [image, setImage] = useState<AttachedImage | null>(null)
  const [drafts, setDrafts] = useState<DraftEvent[]>([])
  const [tab, setTab] = useState<InspectorTab>('drafts')
  const [parsing, setParsing] = useState(false)
  const [stage, setStage] = useState('正在拆解时间表达…')
  const [engineLabel, setEngineLabel] = useState('离线规则')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [activeEventId, setActiveEventId] = useState<string | null>(null)
  const [mobileSheet, setMobileSheet] = useState<MobileSheet>(null)
  const [toast, setToast] = useState<ToastState>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null)

  const hasAiKey = apiKey.trim().length > 0
  const syncConnected = Boolean(
    settings.githubOwner && settings.githubRepo && githubToken,
  )
  const activeEvent = events.find((event) => event.id === activeEventId) ?? null
  const selectedDrafts = drafts.filter((draft) => draft.selected)
  const previewEvents = selectedDrafts.map((draft) => {
    const { selected: _selected, ...event } = draft
    void _selected
    return event
  })
  const scheduleDoc = useMemo(
    () => makeScheduleDocument(sortEvents([...events, ...previewEvents]), deviceId),
    [events, previewEvents, deviceId],
  )
  const liveEvents = events.filter((event) => !event.deletedAt)

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
    const locked = settingsOpen || Boolean(activeEvent) || mobileSheet !== null
    document.body.style.overflow = locked ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [settingsOpen, activeEvent, mobileSheet])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const editing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.getAttribute('contenteditable') === 'true'
      if (event.key === 'Escape') {
        setSettingsOpen(false)
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
      document
        .querySelector<HTMLTextAreaElement>(
          isMobile() ? '.capture--compact textarea' : '.capture:not(.capture--compact) textarea',
        )
        ?.focus()
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

  const handleConfirm = () => {
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
        events: imported.events.filter((event) => event && typeof event.id === 'string'),
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

  return (
    <div className="app-shell">
      <aside className="rail">
        <button
          className="rail__brand"
          onClick={() => setSelectedDate(startOfDay(new Date()))}
          title="阑珊时刻"
          type="button"
        >
          <LogoMark size={28} />
        </button>
        <nav className="rail__nav" aria-label="主导航">
          <button className="rail__button is-active" title="时间轴" type="button">
            <Icon name="calendar" size={19} />
            <span>时间轴</span>
          </button>
          <button
            className="rail__button"
            title="整理稿"
            type="button"
            onClick={() => {
              setTab('drafts')
              if (isMobile()) setMobileSheet('review')
            }}
          >
            <Icon name="inbox" size={19} />
            <span>整理稿</span>
            {drafts.length > 0 && <i className="rail__badge">{drafts.length}</i>}
          </button>
          <button
            className="rail__button"
            title="设置"
            type="button"
            onClick={() => setSettingsOpen(true)}
          >
            <Icon name="settings" size={19} />
            <span>设置</span>
          </button>
        </nav>
        <div className="rail__bottom">
          <button
            className="rail__button rail__button--icon"
            title={settings.theme === 'dark' ? '切换到浅色' : '切换到深色'}
            type="button"
            onClick={() =>
              setSettings((current) => ({
                ...current,
                theme: current.theme === 'dark' ? 'light' : 'dark',
              }))
            }
          >
            <Icon name={settings.theme === 'dark' ? 'sun' : 'moon'} size={18} />
            <span>{settings.theme === 'dark' ? '浅色' : '深色'}</span>
          </button>
          <span className="rail__version">v0.1</span>
        </div>
      </aside>

      <CapturePanel {...captureProps} />

      <Timeline
        events={liveEvents}
        drafts={drafts}
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
        onShiftWeek={shiftWeek}
        onToday={() => setSelectedDate(startOfDay(new Date()))}
        onAdd={() => {
          if (isMobile()) setMobileSheet('capture')
          else
            document
              .querySelector<HTMLTextAreaElement>('.capture:not(.capture--compact) textarea')
              ?.focus()
        }}
        onEventClick={(event) => setActiveEventId(event.id)}
        onSync={() => handleSync()}
        onOpenSettings={() => setSettingsOpen(true)}
        syncLabel={syncLabel}
        syncConnected={syncConnected}
        syncing={syncing}
      />

      <Inspector
        drafts={drafts}
        document={scheduleDoc}
        tab={tab}
        onTab={setTab}
        onToggle={handleToggleDraft}
        onSelectAll={handleSelectAll}
        onConfirm={handleConfirm}
        onCopy={handleCopyJson}
        onDownload={handleExport}
        parsing={parsing}
        stage={stage}
        engineLabel={engineLabel}
      />

      <header className="mobile-head">
        <button
          className="mobile-head__brand"
          onClick={() => setSelectedDate(startOfDay(new Date()))}
          type="button"
        >
          <LogoMark size={24} />
          <span>阑珊时刻</span>
        </button>
        <div className="mobile-head__actions">
          <button
            className={`icon-button ${syncConnected ? 'is-synced' : ''}`}
            onClick={() => (syncConnected ? handleSync() : setSettingsOpen(true))}
            aria-label="同步"
            type="button"
          >
            <Icon name={syncConnected ? 'cloud' : 'cloud-off'} size={18} />
          </button>
          <button
            className="icon-button"
            onClick={() => setSettingsOpen(true)}
            aria-label="设置"
            type="button"
          >
            <Icon name="settings" size={18} />
          </button>
        </div>
      </header>

      <nav className="mobile-nav" aria-label="移动端导航">
        <button className="is-active" type="button">
          <Icon name="calendar" size={19} />
          <span>时间轴</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setTab('drafts')
            setMobileSheet('review')
          }}
        >
          <span className="mobile-nav__icon-wrap">
            <Icon name="inbox" size={19} />
            {drafts.length > 0 && <i>{drafts.length}</i>}
          </span>
          <span>整理稿</span>
        </button>
        <button
          className="mobile-nav__capture"
          type="button"
          onClick={() => setMobileSheet('capture')}
          aria-label="记录时间"
        >
          <Icon name="plus" size={22} />
        </button>
        <button type="button" onClick={() => setSettingsOpen(true)}>
          <Icon name="settings" size={19} />
          <span>设置</span>
        </button>
      </nav>

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

      {settingsOpen && (
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

