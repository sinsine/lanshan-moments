import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { Rnd } from 'react-rnd'
import { Icon } from './Icons'
import {
  PANEL_IDS,
  collectGroups,
  createDefaultLayout,
  dockFloatingToRoot,
  dockGroup,
  dockGroupToCorner,
  dockGroupToRoot,
  findGroup,
  floatPanel,
  focusFloating,
  loadLayoutBackup,
  loadStoredLayout,
  normalizeLayout,
  removeFloating,
  removeGroup,
  removePanel,
  saveLayoutBackup,
  saveStoredLayout,
  setActiveTab,
  setMaximized,
  setSplitRatio,
  toggleMaximized,
  updateFloating,
  type DockCorner,
  type DockNode,
  type FloatingWindow,
  type LayoutState,
  type PanelId,
  type SplitNode,
  type TabGroup,
} from '../lib/layout'

export interface DockPanel {
  id: PanelId
  title: string
  icon: ReactNode
  content: ReactNode
}

interface DockWorkspaceProps {
  panels: DockPanel[]
  native: boolean
  onClose: (id: PanelId) => void
  onDetach: (id: PanelId, point?: { x: number; y: number }) => Promise<boolean>
  onFocus: (id: PanelId) => void
  onTogglePanel?: (id: PanelId) => void
  onNotify?: (message: string, tone?: 'default' | 'error') => void
}

interface Rect {
  left: number
  top: number
  width: number
  height: number
}

interface DragView {
  kind: 'group' | 'float'
  id: string
  x: number
  y: number
  moved: boolean
}

interface DragSession extends DragView {
  tabs: PanelId[]
  active: PanelId
  startX: number
  startY: number
  origin: Rect
  target: DropTarget | null
}

type SplitSide = 'left' | 'right' | 'top' | 'bottom'

type DropTarget =
  | { kind: 'merge'; groupId: string; title: string; rect: Rect; label: string }
  | { kind: 'split'; groupId: string; side: SplitSide; title: string; rect: Rect; label: string }
  | { kind: 'root'; side: SplitSide; rect: Rect; label: string }
  | { kind: 'corner'; corner: DockCorner; rect: Rect; label: string }
  | { kind: 'maximize'; rect: Rect; label: string }
  | { kind: 'outside'; rect: null; label: string }

interface MenuState {
  groupId: string
  x: number
  y: number
}

interface MenuItem {
  id: string
  label?: string
  shortcut?: string
  danger?: boolean
  divider?: boolean
  action?: () => void
}

const DRAG_THRESHOLD = 4
const ROOT_EDGE = 8
const CORNER_EDGE = 12
const GROUP_EDGE_MAX = 64
const MIN_PANE_PX = 180

const resizeHandleClasses = {
  top: 'dock-float__resize',
  right: 'dock-float__resize',
  bottom: 'dock-float__resize',
  left: 'dock-float__resize',
  topRight: 'dock-float__resize',
  bottomRight: 'dock-float__resize',
  bottomLeft: 'dock-float__resize',
  topLeft: 'dock-float__resize',
}

function toRect(rect: DOMRect): Rect {
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function isEditingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  return (
    element.tagName === 'INPUT' ||
    element.tagName === 'TEXTAREA' ||
    element.tagName === 'SELECT' ||
    element.getAttribute('contenteditable') === 'true'
  )
}

function sameTarget(a: DropTarget | null, b: DropTarget | null): boolean {
  if (!a || !b) return a === b
  if (a.kind !== b.kind) return false
  if (a.kind === 'merge') return b.kind === 'merge' && a.groupId === b.groupId
  if (a.kind === 'split') {
    return b.kind === 'split' && a.groupId === b.groupId && a.side === b.side
  }
  if (a.kind === 'root') return b.kind === 'root' && a.side === b.side
  if (a.kind === 'corner') return b.kind === 'corner' && a.corner === b.corner
  return true
}

function sideLabel(side: SplitSide): string {
  switch (side) {
    case 'left':
      return '左侧'
    case 'right':
      return '右侧'
    case 'top':
      return '上方'
    default:
      return '下方'
  }
}

export function DockWorkspace({
  panels,
  native,
  onClose,
  onDetach,
  onFocus,
  onTogglePanel,
  onNotify,
}: DockWorkspaceProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const panelIds = panels.map((panel) => panel.id)
  const panelKey = panelIds.join('|')
  const panelMap = new Map(panels.map((panel) => [panel.id, panel]))
  const panelsRef = useRef(panels)
  useEffect(() => {
    panelsRef.current = panels
  }, [panels])
  const onNotifyRef = useRef(onNotify)
  useEffect(() => {
    onNotifyRef.current = onNotify
  }, [onNotify])

  const [layout, setLayout] = useState<LayoutState>(() => {
    const available = panels.map((panel) => panel.id)
    const stored = loadStoredLayout(PANEL_IDS)
    return stored ? normalizeLayout(stored, available) : createDefaultLayout(available)
  })
  const layoutRef = useRef(layout)
  useEffect(() => {
    layoutRef.current = layout
  }, [layout])

  const focusGroupRef = useRef<string | null>(null)
  const [drag, setDrag] = useState<DragView | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [resizing, setResizing] = useState(false)
  const dragRef = useRef<DragSession | null>(null)
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const rafRef = useRef(0)
  const resizeCleanupRef = useRef<(() => void) | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const suppressClickRef = useRef(false)

  const notify = useCallback((message: string, tone: 'default' | 'error' = 'default') => {
    onNotifyRef.current?.(message, tone)
  }, [])

  /* Keep the layout in sync with the panels the app allows us to show. */
  useEffect(() => {
    const available = panelKey ? (panelKey.split('|') as PanelId[]) : []
    setLayout((current) => normalizeLayout(current, available, focusGroupRef.current))
  }, [panelKey])

  /* Auto-save, plus a synchronous save when the window is closing. */
  useEffect(() => {
    const timer = window.setTimeout(() => saveStoredLayout(layout), 260)
    return () => window.clearTimeout(timer)
  }, [layout])

  useEffect(() => {
    const save = () => saveStoredLayout(layoutRef.current)
    window.addEventListener('beforeunload', save)
    return () => window.removeEventListener('beforeunload', save)
  }, [])

  const openMenuAt = (x: number, y: number, groupId: string) => {
    focusGroupRef.current = groupId
    setMenu({
      groupId,
      x: clampNumber(x, 8, Math.max(8, window.innerWidth - 240)),
      y: clampNumber(y, 8, Math.max(8, window.innerHeight - 330)),
    })
  }

  useEffect(() => {
    if (!menu) return
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return
      setMenu(null)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null)
    }
    const onResize = () => setMenu(null)
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onResize)
    }
  }, [menu])

  const cancelActiveDrag = () => {
    dragCleanupRef.current?.()
    dragCleanupRef.current = null
    dragRef.current = null
    if (rafRef.current) {
      window.cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
    suppressClickRef.current = false
    setDrag(null)
    setDropTarget(null)
  }

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.()
      resizeCleanupRef.current?.()
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const resetLayout = useCallback((announce = true) => {
    const available = panelsRef.current.map((panel) => panel.id)
    setLayout(createDefaultLayout(available))
    focusGroupRef.current = null
    if (announce) notify('已恢复默认四栏布局')
  }, [notify])

  const saveBackup = useCallback(() => {
    saveLayoutBackup(layoutRef.current)
    notify('当前布局已保存')
  }, [notify])

  const restoreBackup = useCallback(() => {
    const available = panelsRef.current.map((panel) => panel.id)
    const backup = loadLayoutBackup(PANEL_IDS)
    if (!backup) {
      notify('还没有手动保存的布局', 'error')
      return
    }
    setLayout(normalizeLayout(backup, available, focusGroupRef.current))
    notify('已恢复上次保存的布局')
  }, [notify])

  /* Keyboard: save / reset / toggle panels / maximize. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (menu) setMenu(null)
        if (dragRef.current) cancelActiveDrag()
        return
      }
      if (!(event.ctrlKey || event.metaKey) || isEditingTarget(event.target)) return

      const key = event.key.toLowerCase()
      if (event.shiftKey && key === 'l') {
        event.preventDefault()
        saveBackup()
        return
      }
      if (event.altKey && key === 'r') {
        event.preventDefault()
        resetLayout()
        return
      }
      if (event.shiftKey && key === 'm') {
        event.preventDefault()
        const current = layoutRef.current
        const groupId =
          focusGroupRef.current ?? collectGroups(current.root)[0]?.id ?? null
        if (groupId && findGroup(current.root, groupId)) {
          setLayout((value) => toggleMaximized(value, groupId))
        }
        return
      }
      if (event.shiftKey && /^[1-4]$/.test(event.key)) {
        const panel = PANEL_IDS[Number(event.key) - 1]
        if (onTogglePanel) {
          event.preventDefault()
          onTogglePanel(panel)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [menu, onTogglePanel, resetLayout, saveBackup])

  const findGroupElementAt = (x: number, y: number): HTMLElement | null => {
    const root = rootRef.current
    if (!root) return null
    const stack = document.elementsFromPoint(x, y)
    for (const element of stack) {
      if (!(element instanceof Element)) continue
      const group = element.closest('[data-dock-group]')
      if (group instanceof HTMLElement && root.contains(group)) return group
    }
    return null
  }

  const resolveDropTarget = (x: number, y: number, session: DragSession): DropTarget | null => {
    const root = rootRef.current
    if (!root) return { kind: 'outside', rect: null, label: '独立窗口' }
    const bounds = root.getBoundingClientRect()
    if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) {
      return { kind: 'outside', rect: null, label: '独立窗口' }
    }

    const innerX = x - bounds.left
    const innerY = y - bounds.top
    const innerRight = bounds.right - x
    const innerBottom = bounds.bottom - y
    const nearLeft = innerX <= ROOT_EDGE
    const nearRight = innerRight <= ROOT_EDGE
    const nearTop = innerY <= ROOT_EDGE
    const nearBottom = innerBottom <= ROOT_EDGE

    /* Workspace corners get a true quarter snap. */
    if ((nearLeft || nearRight) && (nearTop || nearBottom)) {
      const corner: DockCorner =
        nearLeft && nearTop
          ? 'left-top'
          : nearLeft && nearBottom
            ? 'left-bottom'
            : nearRight && nearTop
              ? 'right-top'
              : 'right-bottom'
      const left = nearLeft ? bounds.left : bounds.left + bounds.width / 2
      const top = nearTop ? bounds.top : bounds.top + bounds.height / 2
      return {
        kind: 'corner',
        corner,
        rect: {
          left,
          top,
          width: bounds.width / 2,
          height: bounds.height / 2,
        },
        label: '四分之一铺满',
      }
    }

    if (nearTop && innerX > CORNER_EDGE && innerX < bounds.width - CORNER_EDGE) {
      return {
        kind: 'maximize',
        rect: toRect(bounds),
        label: '最大化铺满',
      }
    }

    if (nearLeft || nearRight || nearTop || nearBottom) {
      const side: SplitSide = nearLeft ? 'left' : nearRight ? 'right' : nearTop ? 'top' : 'bottom'
      const rect =
        side === 'left'
          ? { left: bounds.left, top: bounds.top, width: bounds.width / 2, height: bounds.height }
          : side === 'right'
            ? {
                left: bounds.left + bounds.width / 2,
                top: bounds.top,
                width: bounds.width / 2,
                height: bounds.height,
              }
            : side === 'top'
              ? {
                  left: bounds.left,
                  top: bounds.top,
                  width: bounds.width,
                  height: bounds.height / 2,
                }
              : {
                  left: bounds.left,
                  top: bounds.top + bounds.height / 2,
                  width: bounds.width,
                  height: bounds.height / 2,
                }
      return {
        kind: 'root',
        side,
        rect,
        label: `停靠到工作区${sideLabel(side)}`,
      }
    }

    const groupElement = findGroupElementAt(x, y)
    if (groupElement) {
      const groupId = groupElement.dataset.dockGroup
      if (groupId && groupId !== session.id) {
        const group = findGroup(layoutRef.current.root, groupId)
        const fallbackTitle = group ? panelMap.get(group.active)?.title : ''
        const title = fallbackTitle || '面板'
        const bar = groupElement.querySelector<HTMLElement>('.dock-group__bar')
        const barRect = bar?.getBoundingClientRect()
        const groupRect = groupElement.getBoundingClientRect()

        if (barRect && y <= barRect.bottom + 4) {
          return {
            kind: 'merge',
            groupId,
            title,
            rect: toRect(groupRect),
            label: `合并标签到「${title}」`,
          }
        }

        const contentTop = Math.max(groupRect.top, barRect?.bottom ?? groupRect.top)
        const contentHeight = Math.max(1, groupRect.bottom - contentTop)
        const edgeX = Math.min(GROUP_EDGE_MAX, groupRect.width * 0.28)
        const edgeY = Math.min(GROUP_EDGE_MAX, contentHeight * 0.3)
        const distances: Array<{ side: SplitSide; distance: number; limit: number }> = [
          { side: 'left', distance: x - groupRect.left, limit: edgeX },
          { side: 'right', distance: groupRect.right - x, limit: edgeX },
          { side: 'top', distance: y - contentTop, limit: edgeY },
          { side: 'bottom', distance: groupRect.bottom - y, limit: edgeY },
        ]
        const nearest = distances.reduce((best, item) =>
          item.distance / Math.max(1, item.limit) < best.distance / Math.max(1, best.limit)
            ? item
            : best,
        )

        if (nearest.distance <= nearest.limit) {
          const side = nearest.side
          const rect =
            side === 'left'
              ? {
                  left: groupRect.left,
                  top: groupRect.top,
                  width: groupRect.width / 2,
                  height: groupRect.height,
                }
              : side === 'right'
                ? {
                    left: groupRect.left + groupRect.width / 2,
                    top: groupRect.top,
                    width: groupRect.width / 2,
                    height: groupRect.height,
                  }
                : side === 'top'
                  ? {
                      left: groupRect.left,
                      top: contentTop,
                      width: groupRect.width,
                      height: contentHeight / 2,
                    }
                  : {
                      left: groupRect.left,
                      top: contentTop + contentHeight / 2,
                      width: groupRect.width,
                      height: contentHeight / 2,
                    }
          return {
            kind: 'split',
            groupId,
            side,
            title,
            rect,
            label: `停靠到「${title}」${sideLabel(side)}`,
          }
        }

        return {
          kind: 'merge',
          groupId,
          title,
          rect: toRect(groupRect),
          label: `合并标签到「${title}」`,
        }
      }
    }

    return null
  }

  const finishOutside = async (
    session: DragSession,
    point?: { x: number; y: number },
  ) => {
    if (session.kind === 'float') {
      notify('独立窗口请用标题栏的「停靠」按钮收回', 'error')
      return
    }
    const current = layoutRef.current
    const group = findGroup(current.root, session.id)
    if (!group) return

    if (!native) {
      const available = panelsRef.current.map((panel) => panel.id)
      const next = normalizeLayout(current, available, group.id)
      const root = rootRef.current?.getBoundingClientRect()
      const origin = session.origin
      const x = origin.left - (root?.left ?? 0) + 18
      const y = origin.top - (root?.top ?? 0) + 12
      const width = Math.min(origin.width, Math.max(320, (root?.width ?? 1200) - 40))
      const height = Math.min(origin.height, Math.max(220, (root?.height ?? 800) - 40))
      setLayout(
        floatPanel(next, group.active, {
          x: clampNumber(x, 8, Math.max(8, (root?.width ?? 1200) - width - 8)),
          y: clampNumber(y, 8, Math.max(8, (root?.height ?? 800) - height - 8)),
          width,
          height,
        }),
      )
      notify('已转为浮动窗口；桌面版会打开独立系统窗口')
      return
    }

    const panel = group.active
    const ok = await onDetach(panel, point)
    if (!ok) return
    setLayout((value) => removePanel(value, panel))
    if (group.tabs.length > 1) {
      notify(`「${panelMap.get(panel)?.title ?? panel}」已独立，其余标签保留在主窗口`)
    }
  }

  const commitDrop = (session: DragSession, target: DropTarget) => {
    if (target.kind === 'merge') {
      setLayout((current) => dockGroup(current, session.id, target.groupId, 'center'))
      focusGroupRef.current = target.groupId
      return
    }
    if (target.kind === 'split') {
      setLayout((current) => dockGroup(current, session.id, target.groupId, target.side))
      focusGroupRef.current = target.groupId
      return
    }
    if (target.kind === 'root') {
      setLayout((current) => dockGroupToRoot(current, session.id, target.side))
      return
    }
    if (target.kind === 'corner') {
      setLayout((current) => dockGroupToCorner(current, session.id, target.corner))
      return
    }
    if (target.kind === 'maximize') {
      setLayout((current) => setMaximized(current, session.id))
    }
  }

  const beginDrag = (
    event: ReactPointerEvent<HTMLElement>,
    kind: 'group' | 'float',
    id: string,
    tabs: PanelId[],
    active: PanelId,
    origin: Rect,
  ) => {
    const target = event.target as HTMLElement
    if (target.closest('.dock-group__action, .dock-group__menu-button')) return
    if (event.button !== 0) return

    const session: DragSession = {
      kind,
      id,
      tabs: [...tabs],
      active,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      moved: false,
      origin,
      target: null,
    }
    dragRef.current = session
    setDrag({ kind, id, x: event.clientX, y: event.clientY, moved: false })
    setDropTarget(null)
    focusGroupRef.current = id
    onFocus(active)

    const captureElement = event.currentTarget
    const pointerId = event.pointerId
    let captured = false

    let finished = false

    const cleanup = () => {
      if (finished) return
      finished = true
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKeyDown)
      document.body.classList.remove('dock-is-dragging')
      if (captured) {
        try {
          captureElement.releasePointerCapture(pointerId)
        } catch {
          // Already released by the browser.
        }
      }
      dragCleanupRef.current = null
    }

    const onMove = (moveEvent: PointerEvent) => {
      const current = dragRef.current
      if (!current) return
      current.x = moveEvent.clientX
      current.y = moveEvent.clientY
      if (!current.moved) {
        const distance = Math.hypot(
          current.x - current.startX,
          current.y - current.startY,
        )
        if (distance < DRAG_THRESHOLD) return
        current.moved = true
        document.body.classList.add('dock-is-dragging')
        if (moveEvent.cancelable) moveEvent.preventDefault()
        try {
          captureElement.setPointerCapture(pointerId)
          captured = true
        } catch {
          // Pointer capture is a best-effort improvement; window listeners still work.
        }
      }
      if (rafRef.current) return
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = 0
        const latest = dragRef.current
        if (!latest || !latest.moved) return
        const nextTarget = resolveDropTarget(latest.x, latest.y, latest)
        latest.target = nextTarget
        setDrag({
          kind: latest.kind,
          id: latest.id,
          x: latest.x,
          y: latest.y,
          moved: true,
        })
        setDropTarget((previous) => (sameTarget(previous, nextTarget) ? previous : nextTarget))
      })
    }

    const onUp = (upEvent: PointerEvent) => {
      const current = dragRef.current
      cleanup()
      if (!current) return
      if (!current.moved) {
        dragRef.current = null
        setDrag(null)
        setDropTarget(null)
        return
      }
      current.x = upEvent.clientX
      current.y = upEvent.clientY
      const finalTarget = resolveDropTarget(current.x, current.y, current)
      dragRef.current = null
      if (rafRef.current) {
        window.cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
      }
      setDrag(null)
      setDropTarget(null)
      suppressClickRef.current = true
      window.setTimeout(() => {
        suppressClickRef.current = false
      }, 0)
      if (!finalTarget || finalTarget.kind === 'outside') {
        void finishOutside(current, {
          x: upEvent.screenX,
          y: upEvent.screenY,
        })
        return
      }
      commitDrop(current, finalTarget)
    }

    const onCancel = () => {
      cancelActiveDrag()
    }

    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === 'Escape') {
        keyEvent.preventDefault()
        cancelActiveDrag()
      }
    }

    dragCleanupRef.current = cleanup
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKeyDown)
  }

  const beginGroupDrag = (event: ReactPointerEvent<HTMLElement>, group: TabGroup) => {
    const element = event.currentTarget.closest('[data-dock-group]') as HTMLElement | null
    const origin = element ? toRect(element.getBoundingClientRect()) : {
      left: 0,
      top: 0,
      width: 300,
      height: 220,
    }
    beginDrag(event, 'group', group.id, group.tabs, group.active, origin)
  }

  const beginResize = (event: ReactPointerEvent<HTMLButtonElement>, node: SplitNode) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const splitElement = event.currentTarget.closest('[data-split-id]') as HTMLElement | null
    if (!splitElement) return
    const rect = splitElement.getBoundingClientRect()
    setResizing(true)
    document.body.classList.add('dock-is-resizing')
    let raf = 0
    let finished = false

    const cleanup = () => {
      if (finished) return
      finished = true
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', cleanup)
      window.removeEventListener('pointercancel', cleanup)
      document.body.classList.remove('dock-is-resizing')
      if (raf) window.cancelAnimationFrame(raf)
      resizeCleanupRef.current = null
      setResizing(false)
    }

    const onMove = (moveEvent: PointerEvent) => {
      if (raf) return
      raf = window.requestAnimationFrame(() => {
        raf = 0
        const horizontal = node.direction === 'row'
        const total = horizontal ? rect.width : rect.height
        if (total <= 0) return
        const position = horizontal ? moveEvent.clientX - rect.left : moveEvent.clientY - rect.top
        const minRatio = Math.max(8, (MIN_PANE_PX / total) * 100)
        const ratio = clampNumber((position / total) * 100, Math.min(50, minRatio), 100 - Math.min(50, minRatio))
        setLayout((current) => setSplitRatio(current, node.id, ratio))
      })
    }

    resizeCleanupRef.current = cleanup
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerup', cleanup)
    window.addEventListener('pointercancel', cleanup)
  }

  const activateTab = (group: TabGroup, panel: PanelId) => {
    setLayout((current) => setActiveTab(current, group.id, panel))
    focusGroupRef.current = group.id
    onFocus(panel)
  }

  const closePanel = (panel: PanelId) => {
    setLayout((current) => removePanel(current, panel))
    onClose(panel)
  }

  const closeGroup = (group: TabGroup) => {
    for (const panel of group.tabs) onClose(panel)
    setLayout((current) => removeGroup(current, group.id))
  }

  const detachPanel = async (group: TabGroup, panel: PanelId) => {
    if (!native) {
      const element = document.querySelector<HTMLElement>(
        `[data-dock-group="${CSS.escape(group.id)}"]`,
      )
      const bounds = element?.getBoundingClientRect()
      const root = rootRef.current?.getBoundingClientRect()
      const x = bounds ? bounds.left - (root?.left ?? 0) + 16 : 24
      const y = bounds ? bounds.top - (root?.top ?? 0) + 16 : 24
      const width = bounds?.width ?? 520
      const height = bounds?.height ?? 420
      setLayout((current) =>
        floatPanel(current, panel, {
          x: clampNumber(x, 8, Math.max(8, (root?.width ?? 1200) - width - 8)),
          y: clampNumber(y, 8, Math.max(8, (root?.height ?? 800) - height - 8)),
          width: Math.min(width, Math.max(320, (root?.width ?? 1200) - 16)),
          height: Math.min(height, Math.max(220, (root?.height ?? 800) - 16)),
        }),
      )
      notify('已转为浮动窗口；桌面版会打开独立系统窗口')
      return
    }
    const ok = await onDetach(panel)
    if (!ok) return
    setLayout((current) => removePanel(current, panel))
    if (group.tabs.length > 1) {
      notify(`「${panelMap.get(panel)?.title ?? panel}」已放到独立窗口`)
    }
  }

  const dockFloat = (float: FloatingWindow) => {
    setLayout((current) => dockFloatingToRoot(current, float.id, 'right'))
    focusGroupRef.current = float.id
    notify('已停靠回主工作区')
  }

  const handleFloatDragStop = (
    float: FloatingWindow,
    data: { x: number; y: number },
  ) => {
    const root = rootRef.current
    const width = root?.clientWidth ?? 1200
    const height = root?.clientHeight ?? 800
    const nextX = clampNumber(data.x, 0, Math.max(0, width - 180))
    const nextY = clampNumber(data.y, 0, Math.max(0, height - 120))
    const dockSide: SplitSide | null =
      nextX <= 3
        ? 'left'
        : nextX + float.width >= width - 3
          ? 'right'
          : nextY <= 3
            ? 'top'
            : nextY + float.height >= height - 3
              ? 'bottom'
              : null

    if (dockSide) {
      setLayout((current) => dockFloatingToRoot(current, float.id, dockSide))
      notify('已停靠回主工作区')
      return
    }

    setLayout((current) =>
      updateFloating(current, float.id, { x: Math.round(nextX), y: Math.round(nextY) }),
    )
  }

  const renderGroup = (group: TabGroup, maximized = false): ReactNode => {
    const active = panelMap.get(group.active)
    if (!active) return null
    const dragging = drag?.moved === true && drag.id === group.id
    const mergeTarget =
      dropTarget?.kind === 'merge' && dropTarget.groupId === group.id
    const maxed = maximized || layout.maximized === group.id
    return (
      <section
        className={[
          'dock-group',
          dragging ? 'dock-group--dragging' : '',
          mergeTarget ? 'dock-group--merge-target' : '',
          maxed ? 'dock-group--maximized' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        data-dock-group={group.id}
        data-active-panel={group.active}
        data-maximized={maxed ? 'true' : undefined}
        aria-label={active.title}
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
          openMenuAt(event.clientX, event.clientY, group.id)
        }}
      >
        <header
          className="dock-group__bar"
          onPointerDown={(event) => beginGroupDrag(event, group)}
          onDoubleClick={(event) => {
            if ((event.target as HTMLElement).closest('button')) return
            setLayout((current) => toggleMaximized(current, group.id))
          }}
          title="拖动标题栏停靠；双击最大化/还原"
        >
          {group.tabs.length > 1 ? (
            <div className="dock-group__tabs" role="tablist" aria-label="面板标签">
              {group.tabs.map((panelId) => {
                const panel = panelMap.get(panelId)
                if (!panel) return null
                return (
                  <button
                    type="button"
                    role="tab"
                    key={panelId}
                    className={`dock-group__tab ${panelId === group.active ? 'is-active' : ''}`}
                    aria-selected={panelId === group.active}
                    title={panel.title}
                    onClick={() => {
                      if (suppressClickRef.current) return
                      activateTab(group, panelId)
                    }}
                  >
                    {panel.title}
                  </button>
                )
              })}
            </div>
          ) : (
            <>
              <span className="dock-group__icon" aria-hidden="true">
                {active.icon}
              </span>
              <span className="dock-group__title">{active.title}</span>
            </>
          )}
          <div className="dock-group__actions">
            {maxed ? (
              <button
                type="button"
                className="dock-group__action dock-group__menu-button"
                title="还原窗口"
                aria-label="还原窗口"
                onClick={() => setLayout((current) => setMaximized(current, null))}
              >
                <Icon name="square" size={11} />
              </button>
            ) : null}
            <button
              type="button"
              className="dock-group__action"
              title={native ? '放到独立窗口' : '浮动为窗口'}
              aria-label={`把${active.title}放到独立窗口`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => void detachPanel(group, group.active)}
            >
              <Icon name="external" size={12} />
            </button>
            <button
              type="button"
              className="dock-group__action"
              title="关闭"
              aria-label={`关闭${active.title}`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => closePanel(group.active)}
            >
              <Icon name="x" size={13} />
            </button>
            <button
              type="button"
              className="dock-group__action dock-group__menu-button"
              title="面板菜单"
              aria-label={`${active.title}菜单`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
                openMenuAt(rect.left - 150, rect.bottom + 2, group.id)
              }}
            >
              <Icon name="chevron-down" size={12} />
            </button>
          </div>
        </header>
        <div className="dock-group__content">{active.content}</div>
      </section>
    )
  }

  const renderNode = (node: DockNode): ReactNode => {
    if (node.kind === 'tabs') return renderGroup(node)
    const horizontal = node.direction === 'row'
    return (
      <div
        className={`dock-split dock-split--${node.direction}`}
        data-split-id={node.id}
      >
        <div
          className="dock-split__pane dock-split__pane--first"
          style={{ flexBasis: `calc(${node.ratio}% - 4px)` }}
        >
          {renderNode(node.first)}
        </div>
        <div className="dock-split__pane dock-split__pane--second">
          {renderNode(node.second)}
        </div>
        <button
          type="button"
          className={`dock-splitter dock-splitter--${node.direction}`}
          style={
            horizontal
              ? { left: `calc(${node.ratio}% - 4px)` }
              : { top: `calc(${node.ratio}% - 4px)` }
          }
          onPointerDown={(event) => beginResize(event, node)}
          onDoubleClick={() => setLayout((current) => setSplitRatio(current, node.id, 50))}
          aria-label="拖动调整面板比例"
          title="拖动调整比例；双击复位 50%"
        />
      </div>
    )
  }

  const renderFloating = (float: FloatingWindow): ReactNode => {
    const active = panelMap.get(float.active)
    if (!active) return null
    return (
      <Rnd
        key={float.id}
        className="dock-float"
        position={{ x: float.x, y: float.y }}
        size={{ width: float.width, height: float.height }}
        minWidth={300}
        minHeight={200}
        bounds="parent"
        dragHandleClassName="dock-float__bar"
        cancel=".dock-float__action,.dock-float__tab"
        resizeHandleClasses={resizeHandleClasses}
        enableResizing={{
          top: true,
          right: true,
          bottom: true,
          left: true,
          topRight: true,
          bottomRight: true,
          bottomLeft: true,
          topLeft: true,
        }}
        style={{ zIndex: float.z }}
        onMouseDown={() => setLayout((current) => focusFloating(current, float.id))}
        onDragStart={() => setLayout((current) => focusFloating(current, float.id))}
        onDragStop={(_event, data) => handleFloatDragStop(float, data)}
        onResizeStop={(_event, _direction, element, _delta, position) => {
          setLayout((current) =>
            updateFloating(current, float.id, {
              x: Math.round(position.x),
              y: Math.round(position.y),
              width: element.offsetWidth,
              height: element.offsetHeight,
            }),
          )
        }}
        role="dialog"
        aria-label={active.title}
      >
        <section className="dock-float__inner" data-floating-id={float.id}>
          <header className="dock-float__bar">
            {float.tabs.length > 1 ? (
              <div className="dock-float__tabs" role="tablist" aria-label="浮动标签">
                {float.tabs.map((panelId) => {
                  const panel = panelMap.get(panelId)
                  if (!panel) return null
                  return (
                    <button
                      type="button"
                      role="tab"
                      key={panelId}
                      className={`dock-float__tab ${panelId === float.active ? 'is-active' : ''}`}
                      aria-selected={panelId === float.active}
                      onClick={() =>
                        setLayout((current) =>
                          updateFloating(current, float.id, { active: panelId }),
                        )
                      }
                    >
                      {panel.title}
                    </button>
                  )
                })}
              </div>
            ) : (
              <>
                <span className="dock-float__icon">{active.icon}</span>
                <span className="dock-float__title">{active.title}</span>
              </>
            )}
            <button
              type="button"
              className="dock-float__action"
              title="停靠回主工作区"
              aria-label="停靠回主工作区"
              onClick={() => dockFloat(float)}
            >
              <Icon name="pin" size={12} />
            </button>
            <button
              type="button"
              className="dock-float__action"
              title="关闭"
              aria-label={`关闭${active.title}`}
              onClick={() => {
                closePanel(float.active)
                setLayout((current) => removeFloating(current, float.id))
              }}
            >
              <Icon name="x" size={12} />
            </button>
          </header>
          <div className="dock-float__content">{active.content}</div>
          <div className="dock-float__hint" aria-hidden="true">
            拖到工作区边缘停靠
          </div>
        </section>
      </Rnd>
    )
  }

  const maximizedGroup = layout.maximized
    ? findGroup(layout.root, layout.maximized)
    : null
  const menuGroup = menu ? findGroup(layout.root, menu.groupId) : null
  const menuPanel = menuGroup ? panelMap.get(menuGroup.active) : null
  const menuItems: MenuItem[] = menuGroup
    ? [
        {
          id: 'float',
          label: native ? '移到独立窗口' : '浮动为窗口',
          action: () => void detachPanel(menuGroup, menuGroup.active),
        },
        {
          id: 'maximize',
          label: layout.maximized === menuGroup.id ? '还原窗口' : '最大化',
          action: () =>
            setLayout((current) => toggleMaximized(current, menuGroup.id)),
        },
        {
          id: 'fullscreen',
          label: '全屏铺满',
          action: () => {
            setLayout((current) => setMaximized(current, menuGroup.id))
            window.requestAnimationFrame(() => {
              const element = rootRef.current?.querySelector<HTMLElement>(
                '.dock-group--maximized',
              )
              if (element?.requestFullscreen) {
                void element.requestFullscreen().catch(() => {
                  notify('当前环境不支持全屏', 'error')
                })
              }
            })
          },
        },
        { id: 'divider-1', divider: true },
        {
          id: 'close',
          label: menuPanel ? `关闭「${menuPanel.title}」` : '关闭当前页',
          danger: true,
          action: () => closePanel(menuGroup.active),
        },
        ...(menuGroup.tabs.length > 1
          ? [
              {
                id: 'close-group',
                label: `关闭整个标签组（${menuGroup.tabs.length}）`,
                danger: true,
                action: () => closeGroup(menuGroup),
              } satisfies MenuItem,
            ]
          : []),
        { id: 'divider-2', divider: true },
        {
          id: 'save',
          label: '保存当前布局',
          shortcut: 'Ctrl+Shift+L',
          action: saveBackup,
        },
        {
          id: 'restore',
          label: '恢复上次保存的布局',
          action: restoreBackup,
        },
        {
          id: 'reset',
          label: '重置默认布局',
          shortcut: 'Ctrl+Alt+R',
          danger: true,
          action: () => {
            if (window.confirm('恢复默认四栏布局？当前停靠结构会被替换。')) resetLayout()
          },
        },
      ]
    : []

  return (
    <div
      ref={rootRef}
      className={[
        'dock-workspace',
        drag?.moved ? 'dock-workspace--dragging' : '',
        resizing ? 'dock-workspace--resizing' : '',
        maximizedGroup ? 'dock-workspace--maximized' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-dock-workspace=""
    >
      {maximizedGroup
        ? renderGroup(maximizedGroup, true)
        : layout.root
          ? renderNode(layout.root)
          : (
              <div className="dock-empty">
                <p>所有面板都已关闭</p>
                <span>从顶部「窗口」菜单重新打开，或按 Ctrl+Shift+1~4</span>
              </div>
            )}

      {layout.floating.map(renderFloating)}

      {drag?.moved && dropTarget && dropTarget.kind !== 'outside' ? (
        <div
          className={`dock-drop-preview dock-drop-preview--${dropTarget.kind}`}
          style={{
            left: dropTarget.rect.left,
            top: dropTarget.rect.top,
            width: dropTarget.rect.width,
            height: dropTarget.rect.height,
          }}
          aria-hidden="true"
        >
          <span>{dropTarget.label}</span>
        </div>
      ) : null}

      {drag?.moved ? (
        <div className="dock-ghost" style={{ left: drag.x, top: drag.y }} aria-hidden="true">
          <span className="dock-ghost__title">
            {panelMap.get(
              findGroup(layout.root, drag.id)?.active ?? panelMap.keys().next().value ?? 'capture',
            )?.title ?? '面板'}
          </span>
          <span className="dock-ghost__hint">
            {dropTarget?.label ??
              (native ? '松开，放到独立窗口' : '松开，转为浮动窗口')}
          </span>
        </div>
      ) : null}

      {menu && menuGroup ? (
        <div
          className="dock-menu"
          ref={menuRef}
          style={{ left: menu.x, top: menu.y }}
          role="menu"
          aria-label={`${menuPanel?.title ?? '面板'}菜单`}
        >
          {menuItems.map((item) =>
            item.divider ? (
              <div className="dock-menu__divider" key={item.id} role="separator" />
            ) : (
              <button
                type="button"
                key={item.id}
                role="menuitem"
                className={`dock-menu__item ${item.danger ? 'is-danger' : ''}`}
                onClick={() => {
                  setMenu(null)
                  item.action?.()
                }}
              >
                <span>{item.label}</span>
                {item.shortcut ? <small>{item.shortcut}</small> : null}
              </button>
            ),
          )}
        </div>
      ) : null}
    </div>
  )
}
