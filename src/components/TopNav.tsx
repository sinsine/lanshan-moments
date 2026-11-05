import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { APP_VERSION } from '../lib/config'
import { Icon, LogoMark } from './Icons'

/**
 * Desktop top navigation bar: brand, four app menus (应用 / 编辑 / 窗口 / 设置),
 * sync status pill and theme toggle. Styling lives in the scoped `<style>`
 * block below (hoisted and de-duplicated by React 19 via href/precedence);
 * it only consumes the design tokens from `src/index.css`, so there are no
 * hard-coded colours and no extra stylesheet to wire up.
 */

export type TopNavWindowId = 'timeline' | 'week' | 'inbox' | 'capture' | 'settings'

export type TopNavSettingsTab = 'ai' | 'sync' | 'data'

export type TopNavEditAction =
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'delete'
  | 'selectAll'

export interface TopNavWindow {
  id: TopNavWindowId
  label: string
  visible: boolean
}

export interface TopNavProps {
  windows: Array<TopNavWindow>
  onToggleWindow: (id: TopNavWindowId) => void
  onOpenAbout: () => void
  onOpenAuthor: () => void
  onCheckUpdates: () => void
  onOpenChangelog: () => void
  onExit: () => void
  onOpenSettingsTab: (tab: TopNavSettingsTab) => void
  onEditAction: (action: TopNavEditAction) => void
  syncLabel: string
  syncConnected: boolean
  syncing: boolean
  githubAvatar?: string
  onSync: () => void
  onOpenSyncSettings: () => void
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  nativeWindow?: boolean
  onMinimize?: () => void
  onMaximize?: () => void
  onCloseWindow?: () => void
}

const COPY = {
  brand: '阑珊时刻',
  navLabel: '应用菜单栏',
  menus: {
    app: '应用',
    edit: '编辑',
    window: '窗口',
    settings: '设置',
  },
  app: {
    about: '关于 阑珊时刻',
    author: '关于作者',
    checkUpdates: '检查更新',
    changelog: '更新日志',
    exit: '退出',
  },
  edit: {
    undo: '撤销',
    redo: '重做',
    cut: '剪切',
    copy: '复制',
    paste: '粘贴',
    delete: '删除',
    selectAll: '全选',
  },
  window: {
    empty: '暂无可切换的窗口',
  },
  settings: {
    ai: '模型接口',
    sync: '多设备同步',
    data: '数据',
  },
  shortcuts: {
    undo: 'Ctrl+Z',
    redo: 'Ctrl+Y',
    cut: 'Ctrl+X',
    copy: 'Ctrl+C',
    paste: 'Ctrl+V',
    selectAll: 'Ctrl+A',
  },
  sync: {
    syncTitle: '立即同步',
    settingsTitle: '配置同步',
    busyTitle: '正在同步…',
    aria: (label: string, connected: boolean) =>
      connected ? `同步状态：${label}，点击立即同步` : `同步状态：${label}，点击配置同步`,
  },
  theme: {
    toLight: '切换到浅色主题',
    toDark: '切换到深色主题',
  },
} as const

type MenuId = 'app' | 'edit' | 'window' | 'settings'

const MENUS: ReadonlyArray<{ id: MenuId; label: string }> = [
  { id: 'app', label: COPY.menus.app },
  { id: 'edit', label: COPY.menus.edit },
  { id: 'window', label: COPY.menus.window },
  { id: 'settings', label: COPY.menus.settings },
]

type MenuRow =
  | {
      kind: 'item'
      id: string
      label: string
      shortcut?: string
      checked?: boolean
      onSelect: () => void
    }
  | { kind: 'divider'; id: string }
  | { kind: 'empty'; id: string; label: string }

type MenuItemRow = Extract<MenuRow, { kind: 'item' }>

const TOPNAV_CSS = `
.topnav {
  position: relative;
  z-index: 40;
  display: flex;
  align-items: center;
  height: 46px;
  padding: 0 8px 0 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  background: var(--glass-bg);
  box-shadow: var(--shadow-soft), inset 0 1px 0 var(--line);
  backdrop-filter: blur(var(--glass-blur)) saturate(140%);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(140%);
  color: var(--text);
  font-family: var(--font-ui);
  -webkit-user-select: none;
  user-select: none;
}

.topnav-brand {
  display: flex;
  align-items: center;
  gap: 9px;
  color: var(--text-strong);
}

.topnav-brand svg {
  opacity: 0.9;
}

.topnav-brand-name {
  padding-right: 2px;
  font-family: var(--font-serif);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.16em;
  white-space: nowrap;
}

.topnav-version {
  margin-left: 3px;
  color: var(--faint);
  font-family: var(--mono);
  font-size: 9px;
  font-weight: 400;
  letter-spacing: 0.02em;
  line-height: 1.4;
  white-space: nowrap;
  opacity: 0.82;
}

.topnav-menus {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  margin-left: 10px;
  padding-left: 12px;
  border-left: 1px solid var(--line);
}

.menu {
  position: relative;
  display: flex;
  align-items: center;
}

.menu-trigger {
  display: inline-flex;
  align-items: center;
  height: 30px;
  padding: 0 12px;
  border-radius: var(--radius-pill);
  color: var(--muted);
  font-size: 12px;
  letter-spacing: 0.08em;
  white-space: nowrap;
  transition: color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease);
}

.menu-trigger:hover {
  color: var(--text-strong);
  background: var(--glass-bg-hover);
}

.menu-trigger[aria-expanded='true'] {
  color: var(--text-strong);
  background: var(--panel-3);
}

.menu-panel {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  z-index: 50;
  min-width: 244px;
  max-height: min(70vh, 480px);
  padding: 6px;
  overflow-y: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-m);
  background: var(--nav-bg);
  box-shadow: var(--shadow-glass);
  backdrop-filter: blur(28px) saturate(160%);
  -webkit-backdrop-filter: blur(28px) saturate(160%);
  transform-origin: top left;
  animation: topnav-menu-in var(--dur-fast) var(--ease) both;
}

@keyframes topnav-menu-in {
  from {
    opacity: 0;
    transform: translateY(-4px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  height: 32px;
  padding: 0 10px 0 8px;
  border-radius: var(--radius-s);
  color: var(--text);
  font-size: 12.5px;
  letter-spacing: 0.02em;
  text-align: left;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}

.menu-item:hover,
.menu-item:focus-visible {
  background: var(--glass-bg-hover);
  color: var(--text-strong);
}

.menu-item-check {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 14px;
  height: 14px;
  color: var(--amber);
  opacity: 0;
}

.menu-item-check--on {
  opacity: 1;
}

.menu-item-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.menu-item-shortcut {
  flex: 0 0 auto;
  padding-left: 16px;
  color: var(--faint);
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.02em;
}

.menu-item:hover .menu-item-shortcut,
.menu-item:focus-visible .menu-item-shortcut {
  color: var(--muted);
}

.menu-divider {
  height: 1px;
  margin: 5px 8px;
  background: var(--line);
}

.menu-empty {
  margin: 0;
  padding: 9px 10px;
  color: var(--faint);
  font-size: 11.5px;
}

.topnav-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  padding-left: 16px;
}

.topnav-sync {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 11px;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  color: var(--faint);
  font-size: 11px;
  letter-spacing: 0.02em;
  transition: color var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease),
    background var(--dur-fast) var(--ease);
}

.topnav-sync:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--line-strong);
  background: var(--glass-bg-hover);
}

.topnav-sync:disabled {
  cursor: default;
  opacity: 0.72;
}

.topnav-sync--on {
  color: var(--muted);
  border-color: var(--line-strong);
}

.topnav-sync-dot {
  flex: 0 0 auto;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.4;
}

.topnav-sync--on .topnav-sync-dot {
  opacity: 1;
}

.topnav-sync--busy svg {
  animation: topnav-spin 1.1s linear infinite;
}

.topnav-avatar {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid var(--line-strong);
  background: var(--panel-2);
}

.topnav-sync-label {
  max-width: 128px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@keyframes topnav-spin {
  to {
    transform: rotate(360deg);
  }
}

.topnav-theme {
  display: inline-grid;
  flex: 0 0 auto;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-s);
  color: var(--muted);
  transition: color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease);
}

.topnav-theme:hover {
  color: var(--text-strong);
  background: var(--glass-bg-hover);
}

.menu-trigger:focus-visible,
.menu-item:focus-visible,
.topnav-sync:focus-visible,
.topnav-theme:focus-visible {
  outline: 1px solid var(--amber-line);
  outline-offset: 1px;
}

@media (max-width: 980px) {
  .topnav {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .menu-panel,
  .topnav-sync--busy svg {
    animation: none;
  }
}
`

export function TopNav({
  windows,
  onToggleWindow,
  onOpenAbout,
  onOpenAuthor,
  onCheckUpdates,
  onOpenChangelog,
  onExit,
  onOpenSettingsTab,
  onEditAction,
  syncLabel,
  syncConnected,
  syncing,
  githubAvatar,
  onSync,
  onOpenSyncSettings,
  theme,
  onToggleTheme,
  nativeWindow = false,
  onMinimize,
  onMaximize,
  onCloseWindow,
}: TopNavProps) {
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null)
  const baseId = useId()
  const rootRef = useRef<HTMLElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const triggerRefs = useRef<Partial<Record<MenuId, HTMLButtonElement | null>>>({})
  const pendingFocus = useRef<'first' | 'last' | null>(null)

  const appRows: MenuRow[] = [
    { kind: 'item', id: 'about', label: COPY.app.about, onSelect: onOpenAbout },
    { kind: 'item', id: 'author', label: COPY.app.author, onSelect: onOpenAuthor },
    { kind: 'divider', id: 'app-divider-1' },
    { kind: 'item', id: 'updates', label: COPY.app.checkUpdates, onSelect: onCheckUpdates },
    { kind: 'item', id: 'changelog', label: COPY.app.changelog, onSelect: onOpenChangelog },
    { kind: 'divider', id: 'app-divider-2' },
    { kind: 'item', id: 'exit', label: COPY.app.exit, onSelect: onExit },
  ]

  const editRows: MenuRow[] = [
    {
      kind: 'item',
      id: 'undo',
      label: COPY.edit.undo,
      shortcut: COPY.shortcuts.undo,
      onSelect: () => onEditAction('undo'),
    },
    {
      kind: 'item',
      id: 'redo',
      label: COPY.edit.redo,
      shortcut: COPY.shortcuts.redo,
      onSelect: () => onEditAction('redo'),
    },
    { kind: 'divider', id: 'edit-divider-1' },
    {
      kind: 'item',
      id: 'cut',
      label: COPY.edit.cut,
      shortcut: COPY.shortcuts.cut,
      onSelect: () => onEditAction('cut'),
    },
    {
      kind: 'item',
      id: 'copy',
      label: COPY.edit.copy,
      shortcut: COPY.shortcuts.copy,
      onSelect: () => onEditAction('copy'),
    },
    {
      kind: 'item',
      id: 'paste',
      label: COPY.edit.paste,
      shortcut: COPY.shortcuts.paste,
      onSelect: () => onEditAction('paste'),
    },
    { kind: 'item', id: 'delete', label: COPY.edit.delete, onSelect: () => onEditAction('delete') },
    { kind: 'divider', id: 'edit-divider-2' },
    {
      kind: 'item',
      id: 'selectAll',
      label: COPY.edit.selectAll,
      shortcut: COPY.shortcuts.selectAll,
      onSelect: () => onEditAction('selectAll'),
    },
  ]

  const windowRows: MenuRow[] =
    windows.length === 0
      ? [{ kind: 'empty', id: 'empty', label: COPY.window.empty }]
      : windows.map((item): MenuRow => ({
          kind: 'item',
          id: item.id,
          label: item.label,
          checked: item.visible,
          onSelect: () => onToggleWindow(item.id),
        }))

  const settingsRows: MenuRow[] = [
    {
      kind: 'item',
      id: 'settings-ai',
      label: COPY.settings.ai,
      onSelect: () => onOpenSettingsTab('ai'),
    },
    {
      kind: 'item',
      id: 'settings-sync',
      label: COPY.settings.sync,
      onSelect: () => onOpenSettingsTab('sync'),
    },
    {
      kind: 'item',
      id: 'settings-data',
      label: COPY.settings.data,
      onSelect: () => onOpenSettingsTab('data'),
    },
  ]

  const rowsByMenu: Record<MenuId, MenuRow[]> = {
    app: appRows,
    edit: editRows,
    window: windowRows,
    settings: settingsRows,
  }

  const focusMenuItem = (edge: 'first' | 'last') => {
    const items = panelRef.current?.querySelectorAll<HTMLButtonElement>('[data-menu-item]')
    if (!items || items.length === 0) return
    const target = edge === 'last' ? items[items.length - 1] : items[0]
    target?.focus()
  }

  const closeMenu = (restoreFocus: boolean) => {
    const menu = openMenu
    setOpenMenu(null)
    if (restoreFocus && menu) triggerRefs.current[menu]?.focus()
  }

  const enterMenu = (menu: MenuId, edge: 'first' | 'last') => {
    if (openMenu === menu) {
      focusMenuItem(edge)
      return
    }
    pendingFocus.current = edge
    setOpenMenu(menu)
  }

  const moveMenu = (step: 1 | -1) => {
    const currentIndex = Math.max(
      0,
      MENUS.findIndex((menu) => menu.id === openMenu),
    )
    const next = MENUS[(currentIndex + step + MENUS.length) % MENUS.length]
    setOpenMenu(next.id)
    triggerRefs.current[next.id]?.focus()
  }

  const selectRow = (row: MenuItemRow) => {
    closeMenu(true)
    row.onSelect()
  }

  const handleTriggerKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    menu: MenuId,
  ) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      enterMenu(menu, event.key === 'ArrowDown' ? 'first' : 'last')
      return
    }
    if ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && openMenu) {
      event.preventDefault()
      moveMenu(event.key === 'ArrowRight' ? 1 : -1)
    }
  }

  const handlePanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-menu-item]'),
    )
    if (items.length === 0) return
    const current = items.indexOf(document.activeElement as HTMLButtonElement)

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      const index =
        current < 0
          ? step === 1
            ? 0
            : items.length - 1
          : (current + step + items.length) % items.length
      items[index]?.focus()
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      items[event.key === 'Home' ? 0 : items.length - 1]?.focus()
      return
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      moveMenu(event.key === 'ArrowRight' ? 1 : -1)
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      closeMenu(true)
    }
  }

  // Open a keyboard-focused menu item once its panel has rendered.
  useEffect(() => {
    if (!openMenu) return
    const edge = pendingFocus.current
    if (!edge) return
    pendingFocus.current = null
    focusMenuItem(edge)
  }, [openMenu])

  // Outside click and Escape close the open menu; Escape keeps focus on its trigger.
  useEffect(() => {
    if (!openMenu) return
    const menu = openMenu

    const handlePointerDown = (event: PointerEvent) => {
      const root = rootRef.current
      if (root && event.target instanceof Node && root.contains(event.target)) return
      setOpenMenu(null)
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setOpenMenu(null)
      triggerRefs.current[menu]?.focus()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [openMenu])

  const syncClass = [
    'topnav-sync',
    syncConnected ? 'topnav-sync--on' : '',
    syncing ? 'topnav-sync--busy' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const syncTitle = syncing
    ? COPY.sync.busyTitle
    : syncConnected
      ? COPY.sync.syncTitle
      : COPY.sync.settingsTitle

  const themeLabel = theme === 'dark' ? COPY.theme.toLight : COPY.theme.toDark

  return (
    <header className="topnav" ref={rootRef}>
      <style href="lanshan-topnav" precedence="default">
        {TOPNAV_CSS}
      </style>

      <div className="topnav-brand">
        <LogoMark size={22} />
        <span className="topnav-brand-name">{COPY.brand}</span>
        <span className="topnav-version">v{APP_VERSION}</span>
      </div>

      <nav className="topnav-menus" aria-label={COPY.navLabel}>
        {MENUS.map((menu) => {
          const expanded = openMenu === menu.id
          const panelId = `${baseId}-${menu.id}-panel`
          const triggerId = `${baseId}-${menu.id}-trigger`

          return (
            <div className="menu" key={menu.id}>
              <button
                ref={(node) => {
                  triggerRefs.current[menu.id] = node
                }}
                id={triggerId}
                className="menu-trigger"
                type="button"
                aria-haspopup="menu"
                aria-expanded={expanded}
                aria-controls={expanded ? panelId : undefined}
                onClick={() => setOpenMenu(expanded ? null : menu.id)}
                onKeyDown={(event) => handleTriggerKeyDown(event, menu.id)}
                onPointerEnter={(event) => {
                  if (event.pointerType !== 'mouse' || !openMenu || openMenu === menu.id) return
                  setOpenMenu(menu.id)
                }}
              >
                {menu.label}
              </button>

              {expanded && (
                <div
                  id={panelId}
                  ref={panelRef}
                  className="menu-panel"
                  role="menu"
                  aria-label={menu.label}
                  onKeyDown={handlePanelKeyDown}
                >
                  {rowsByMenu[menu.id].map((row) => {
                    if (row.kind === 'divider') {
                      return <div className="menu-divider" key={row.id} role="separator" />
                    }
                    if (row.kind === 'empty') {
                      return (
                        <p className="menu-empty" key={row.id}>
                          {row.label}
                        </p>
                      )
                    }

                    const isToggle = row.checked !== undefined
                    return (
                      <button
                        key={row.id}
                        className="menu-item"
                        type="button"
                        role={isToggle ? 'menuitemcheckbox' : 'menuitem'}
                        aria-checked={isToggle ? row.checked : undefined}
                        tabIndex={-1}
                        data-menu-item=""
                        onClick={() => selectRow(row)}
                      >
                        <span
                          className={
                            row.checked
                              ? 'menu-item-check menu-item-check--on'
                              : 'menu-item-check'
                          }
                          aria-hidden="true"
                        >
                          {row.checked ? <Icon name="check" size={12} /> : null}
                        </span>
                        <span className="menu-item-label">{row.label}</span>
                        {row.shortcut ? (
                          <span className="menu-item-shortcut">{row.shortcut}</span>
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      <div className="topnav-actions">
        <button
          className={syncClass}
          type="button"
          onClick={syncConnected ? onSync : onOpenSyncSettings}
          disabled={syncing}
          title={syncTitle}
          aria-label={COPY.sync.aria(syncLabel, syncConnected)}
          aria-busy={syncing}
        >
          {githubAvatar ? (
            <img
              className="topnav-avatar"
              src={githubAvatar}
              alt=""
              width={18}
              height={18}
              referrerPolicy="no-referrer"
            />
          ) : (
            <Icon
              name={syncing ? 'refresh' : syncConnected ? 'cloud' : 'cloud-off'}
              size={14}
            />
          )}
          <span className="topnav-sync-dot" aria-hidden="true" />
          <span className="topnav-sync-label">{syncLabel}</span>
        </button>

        <button
          className="topnav-theme"
          type="button"
          onClick={onToggleTheme}
          title={themeLabel}
          aria-label={themeLabel}
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
        </button>

        {nativeWindow && (
          <div className="topnav-window-controls">
            <button
              className="topnav-window-control"
              type="button"
              onClick={onMinimize}
              aria-label="最小化"
              title="最小化"
            >
              <Icon name="minus" size={13} />
            </button>
            <button
              className="topnav-window-control"
              type="button"
              onClick={onMaximize}
              aria-label="最大化 / 还原"
              title="最大化 / 还原"
            >
              <Icon name="square" size={11} />
            </button>
            <button
              className="topnav-window-control topnav-window-control--close"
              type="button"
              onClick={onCloseWindow}
              aria-label="关闭"
              title="关闭"
            >
              <Icon name="x" size={13} />
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
