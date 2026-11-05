/**
 * v0.4.3 dock layout model.
 *
 * The desktop workspace is a recursive binary split tree. Every leaf is a tab
 * group; every split stores the ratio of its first child. This module is pure
 * so the drag state machine in DockWorkspace can stay small and predictable.
 *
 * Persisted JSON version 3:
 *   { version, root, floating, maximized, savedAt }
 * Older payloads (flat order list or a flat group list) are migrated on load.
 */

export const LAYOUT_VERSION = 3
export const LAYOUT_STORAGE_KEY = 'lanshan.dock.layout.v3'
export const LAYOUT_BACKUP_KEY = 'lanshan.dock.layout.backup.v3'

export const PANEL_IDS = ['capture', 'inbox', 'week', 'timeline'] as const

export type PanelId = (typeof PANEL_IDS)[number]
export type DockDirection = 'row' | 'column'
export type DockSide = 'left' | 'right' | 'top' | 'bottom' | 'center'

export interface TabGroup {
  kind: 'tabs'
  id: string
  tabs: PanelId[]
  active: PanelId
}

export interface SplitNode {
  kind: 'split'
  id: string
  direction: DockDirection
  /** Percentage of the first child, 12..88. */
  ratio: number
  first: DockNode
  second: DockNode
}

export type DockNode = TabGroup | SplitNode

export interface FloatingWindow {
  id: string
  tabs: PanelId[]
  active: PanelId
  x: number
  y: number
  width: number
  height: number
  z: number
}

export interface LayoutState {
  version: number
  root: DockNode | null
  floating: FloatingWindow[]
  maximized: string | null
  savedAt: number
}

export const MIN_RATIO = 12
export const MAX_RATIO = 88

let idCounter = 0

function makeId(prefix: string): string {
  idCounter += 1
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`
}

export function isPanelId(value: unknown): value is PanelId {
  return typeof value === 'string' && (PANEL_IDS as readonly string[]).includes(value)
}

export function clampRatio(value: number, min = MIN_RATIO, max = MAX_RATIO): number {
  if (!Number.isFinite(value)) return 50
  return Math.max(min, Math.min(max, value))
}

export function dedupePanels(values: readonly PanelId[]): PanelId[] {
  const seen = new Set<PanelId>()
  const result: PanelId[] = []
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value)
      result.push(value)
    }
  }
  return result
}

export function makeGroup(tabs: readonly PanelId[], active?: PanelId): TabGroup {
  const clean = dedupePanels(tabs)
  const nextActive = active && clean.includes(active) ? active : clean[0]
  if (!nextActive) throw new Error('A tab group needs at least one panel')
  return { kind: 'tabs', id: makeId('group'), tabs: clean, active: nextActive }
}

export function makeSplit(
  direction: DockDirection,
  ratio: number,
  first: DockNode,
  second: DockNode,
): SplitNode {
  return {
    kind: 'split',
    id: makeId('split'),
    direction,
    ratio: clampRatio(ratio),
    first,
    second,
  }
}

export function collectGroups(node: DockNode | null): TabGroup[] {
  if (!node) return []
  if (node.kind === 'tabs') return [node]
  return [...collectGroups(node.first), ...collectGroups(node.second)]
}

export function findGroup(node: DockNode | null, groupId: string): TabGroup | null {
  if (!node) return null
  if (node.kind === 'tabs') return node.id === groupId ? node : null
  return findGroup(node.first, groupId) ?? findGroup(node.second, groupId)
}

export function findFloating(layout: LayoutState, floatingId: string): FloatingWindow | null {
  return layout.floating.find((entry) => entry.id === floatingId) ?? null
}

export function findGroupOfPanel(node: DockNode | null, panel: PanelId): TabGroup | null {
  if (!node) return null
  if (node.kind === 'tabs') return node.tabs.includes(panel) ? node : null
  return findGroupOfPanel(node.first, panel) ?? findGroupOfPanel(node.second, panel)
}

export function layoutHasPanel(layout: LayoutState, panel: PanelId): boolean {
  return Boolean(
    findGroupOfPanel(layout.root, panel) ||
      layout.floating.some((entry) => entry.tabs.includes(panel)),
  )
}

export function nextFloatingZ(layout: LayoutState): number {
  return layout.floating.reduce((max, entry) => Math.max(max, entry.z), 20) + 1
}

function updateGroup(node: DockNode, groupId: string, update: (group: TabGroup) => TabGroup): DockNode {
  if (node.kind === 'tabs') return node.id === groupId ? update(node) : node
  const first = updateGroup(node.first, groupId, update)
  const second = updateGroup(node.second, groupId, update)
  if (first === node.first && second === node.second) return node
  return { ...node, first, second }
}

function removeGroupNode(node: DockNode | null, groupId: string): DockNode | null {
  if (!node) return null
  if (node.kind === 'tabs') return node.id === groupId ? null : node
  const first = removeGroupNode(node.first, groupId)
  const second = removeGroupNode(node.second, groupId)
  if (!first && !second) return null
  if (!first) return second
  if (!second) return first
  if (first === node.first && second === node.second) return node
  return { ...node, first, second }
}

function removePanelFromNode(node: DockNode | null, panel: PanelId): DockNode | null {
  if (!node) return null
  if (node.kind === 'tabs') {
    if (!node.tabs.includes(panel)) return node
    const tabs = node.tabs.filter((tab) => tab !== panel)
    if (tabs.length === 0) return null
    return {
      ...node,
      tabs,
      active: tabs.includes(node.active) ? node.active : tabs[0],
    }
  }
  const first = removePanelFromNode(node.first, panel)
  const second = removePanelFromNode(node.second, panel)
  if (!first && !second) return null
  if (!first) return second
  if (!second) return first
  if (first === node.first && second === node.second) return node
  return { ...node, first, second }
}

function insertGroupAt(
  node: DockNode,
  targetId: string,
  side: Exclude<DockSide, 'center'>,
  source: TabGroup,
): DockNode {
  if (node.kind === 'tabs') {
    if (node.id !== targetId) return node
    const horizontal = side === 'left' || side === 'right'
    const sourceFirst = side === 'left' || side === 'top'
    return makeSplit(
      horizontal ? 'row' : 'column',
      50,
      sourceFirst ? source : node,
      sourceFirst ? node : source,
    )
  }
  const first = insertGroupAt(node.first, targetId, side, source)
  const second = insertGroupAt(node.second, targetId, side, source)
  if (first === node.first && second === node.second) return node
  return { ...node, first, second }
}

function splitRoot(root: DockNode, side: Exclude<DockSide, 'center'>, source: TabGroup): DockNode {
  const horizontal = side === 'left' || side === 'right'
  const sourceFirst = side === 'left' || side === 'top'
  return makeSplit(
    horizontal ? 'row' : 'column',
    50,
    sourceFirst ? source : root,
    sourceFirst ? root : source,
  )
}

/** The first-run layout mirrors the familiar four-zone AE arrangement. */
export function createDefaultLayout(available: readonly PanelId[]): LayoutState {
  const valid = new Set(available)
  const groups = PANEL_IDS.filter((id) => valid.has(id)).map((id) => makeGroup([id]))
  let root: DockNode | null = null

  if (groups.length === 1) {
    root = groups[0]
  } else if (groups.length === 2) {
    root = makeSplit('row', 50, groups[0], groups[1])
  } else if (groups.length === 3) {
    root = makeSplit('row', 34, makeSplit('column', 50, groups[0], groups[1]), groups[2])
  } else if (groups.length >= 4) {
    root = makeSplit(
      'row',
      28,
      makeSplit('column', 46, groups[0], groups[1]),
      makeSplit('column', 38, groups[2], groups[3]),
    )
  }

  return {
    version: LAYOUT_VERSION,
    root,
    floating: [],
    maximized: null,
    savedAt: Date.now(),
  }
}

export function addPanel(
  layout: LayoutState,
  panel: PanelId,
  targetGroupId?: string | null,
): LayoutState {
  if (layoutHasPanel(layout, panel)) return layout

  if (!layout.root) {
    return { ...layout, root: makeGroup([panel]), savedAt: Date.now() }
  }

  const groups = collectGroups(layout.root)
  const target =
    (targetGroupId ? findGroup(layout.root, targetGroupId) : null) ?? groups[0] ?? null
  if (!target) return { ...layout, root: makeGroup([panel]), savedAt: Date.now() }

  return {
    ...layout,
    root: updateGroup(layout.root, target.id, (group) => ({
      ...group,
      tabs: [...group.tabs, panel],
      active: panel,
    })),
    savedAt: Date.now(),
  }
}

export function removePanel(layout: LayoutState, panel: PanelId): LayoutState {
  const root = removePanelFromNode(layout.root, panel)
  const floating = layout.floating
    .map((entry) => {
      if (!entry.tabs.includes(panel)) return entry
      const tabs = entry.tabs.filter((tab) => tab !== panel)
      if (tabs.length === 0) return null
      return {
        ...entry,
        tabs,
        active: tabs.includes(entry.active) ? entry.active : tabs[0],
      }
    })
    .filter((entry): entry is FloatingWindow => Boolean(entry))

  return {
    ...layout,
    root,
    floating,
    maximized: root && layout.maximized && findGroup(root, layout.maximized) ? layout.maximized : null,
    savedAt: Date.now(),
  }
}

export function removeGroup(layout: LayoutState, groupId: string): LayoutState {
  const root = removeGroupNode(layout.root, groupId)
  return {
    ...layout,
    root,
    maximized: layout.maximized === groupId ? null : layout.maximized,
    savedAt: Date.now(),
  }
}

export function setMaximized(layout: LayoutState, groupId: string | null): LayoutState {
  if (groupId && !findGroup(layout.root, groupId)) return layout
  return { ...layout, maximized: groupId, savedAt: Date.now() }
}

export function toggleMaximized(layout: LayoutState, groupId: string): LayoutState {
  return setMaximized(layout, layout.maximized === groupId ? null : groupId)
}

export function mergeGroupInto(
  layout: LayoutState,
  sourceId: string,
  targetId: string,
): LayoutState {
  if (sourceId === targetId) return layout
  const source = findGroup(layout.root, sourceId)
  const target = findGroup(layout.root, targetId)
  if (!source || !target) return layout
  const tabs = dedupePanels([...target.tabs, ...source.tabs])
  const root = removeGroupNode(layout.root, sourceId)
  if (!root) return layout
  const nextRoot = updateGroup(root, targetId, (group) => ({
    ...group,
    tabs,
    active: source.active,
  }))
  return {
    ...layout,
    root: nextRoot,
    maximized: layout.maximized === sourceId ? targetId : layout.maximized,
    savedAt: Date.now(),
  }
}

export function dockGroup(
  layout: LayoutState,
  sourceId: string,
  targetId: string,
  side: DockSide,
): LayoutState {
  if (sourceId === targetId) return layout
  const source = findGroup(layout.root, sourceId)
  const target = findGroup(layout.root, targetId)
  if (!source || !target) return layout
  if (side === 'center') return mergeGroupInto(layout, sourceId, targetId)

  const rootWithout = removeGroupNode(layout.root, sourceId)
  if (!rootWithout) return layout
  const nextRoot = insertGroupAt(rootWithout, targetId, side, source)
  if (nextRoot === rootWithout) return layout
  return {
    ...layout,
    root: nextRoot,
    maximized: layout.maximized === sourceId ? null : layout.maximized,
    savedAt: Date.now(),
  }
}

export function dockGroupToRoot(
  layout: LayoutState,
  sourceId: string,
  side: Exclude<DockSide, 'center'>,
): LayoutState {
  const source = findGroup(layout.root, sourceId)
  if (!source) return layout
  const rootWithout = removeGroupNode(layout.root, sourceId)
  const root = rootWithout ? splitRoot(rootWithout, side, source) : source
  return {
    ...layout,
    root,
    maximized: layout.maximized === sourceId ? null : layout.maximized,
    savedAt: Date.now(),
  }
}

export type DockCorner = 'left-top' | 'left-bottom' | 'right-top' | 'right-bottom'

/**
 * Corner snap: the dragged group takes one quarter, the closest other group
 * takes the quarter above/below it, and the rest of the tree keeps the
 * remaining half. This is the only way a binary split tree can give an
 * arbitrary group a true quarter without leaving an empty region.
 */
export function dockGroupToCorner(
  layout: LayoutState,
  sourceId: string,
  corner: DockCorner,
): LayoutState {
  const source = findGroup(layout.root, sourceId)
  if (!source) return layout
  const without = removeGroupNode(layout.root, sourceId)
  if (!without) return layout
  const rest = collectGroups(without)
  if (rest.length === 0) return { ...layout, root: source, savedAt: Date.now() }

  const mate = rest[0]
  const remainder = removeGroupNode(without, mate.id)
  const top = corner === 'left-top' || corner === 'right-top'
  const left = corner === 'left-top' || corner === 'left-bottom'
  const stack = makeSplit('column', 50, top ? source : mate, top ? mate : source)

  let root: DockNode
  if (!remainder) {
    root = stack
  } else {
    root = makeSplit('row', 50, left ? stack : remainder, left ? remainder : stack)
  }

  return {
    ...layout,
    root,
    maximized: layout.maximized === sourceId ? null : layout.maximized,
    savedAt: Date.now(),
  }
}

export function setActiveTab(
  layout: LayoutState,
  groupId: string,
  panel: PanelId,
): LayoutState {
  if (!layout.root) return layout
  const target = findGroup(layout.root, groupId)
  if (!target || !target.tabs.includes(panel) || target.active === panel) return layout
  return {
    ...layout,
    root: updateGroup(layout.root, groupId, (group) => ({ ...group, active: panel })),
    savedAt: Date.now(),
  }
}

export function setSplitRatio(layout: LayoutState, splitId: string, ratio: number): LayoutState {
  const update = (node: DockNode): DockNode => {
    if (node.kind === 'tabs') return node
    if (node.id === splitId) return { ...node, ratio: clampRatio(ratio) }
    const first = update(node.first)
    const second = update(node.second)
    if (first === node.first && second === node.second) return node
    return { ...node, first, second }
  }
  if (!layout.root) return layout
  const root = update(layout.root)
  return root === layout.root ? layout : { ...layout, root, savedAt: Date.now() }
}

export function resetSplitRatio(layout: LayoutState, splitId: string): LayoutState {
  return setSplitRatio(layout, splitId, 50)
}

export function addFloating(
  layout: LayoutState,
  tabs: readonly PanelId[],
  active: PanelId | undefined,
  bounds: { x: number; y: number; width: number; height: number },
): LayoutState {
  const clean = dedupePanels(tabs)
  if (clean.length === 0) return layout
  const nextActive = active && clean.includes(active) ? active : clean[0]
  const floating: FloatingWindow = {
    id: makeId('float'),
    tabs: clean,
    active: nextActive,
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(280, Math.round(bounds.width)),
    height: Math.max(180, Math.round(bounds.height)),
    z: nextFloatingZ(layout),
  }
  return { ...layout, floating: [...layout.floating, floating], savedAt: Date.now() }
}

export function updateFloating(
  layout: LayoutState,
  floatingId: string,
  patch: Partial<Pick<FloatingWindow, 'x' | 'y' | 'width' | 'height' | 'active' | 'z'>>,
): LayoutState {
  let changed = false
  const floating = layout.floating.map((entry) => {
    if (entry.id !== floatingId) return entry
    changed = true
    return { ...entry, ...patch }
  })
  return changed ? { ...layout, floating, savedAt: Date.now() } : layout
}

export function focusFloating(layout: LayoutState, floatingId: string): LayoutState {
  const target = findFloating(layout, floatingId)
  if (!target || target.z >= nextFloatingZ(layout) - 1) return layout
  return updateFloating(layout, floatingId, { z: nextFloatingZ(layout) })
}

export function removeFloating(layout: LayoutState, floatingId: string): LayoutState {
  const floating = layout.floating.filter((entry) => entry.id !== floatingId)
  if (floating.length === layout.floating.length) return layout
  return { ...layout, floating, savedAt: Date.now() }
}

/** Float one panel; if its group had other tabs, those stay docked. */
export function floatPanel(
  layout: LayoutState,
  panel: PanelId,
  bounds: { x: number; y: number; width: number; height: number },
): LayoutState {
  if (!layoutHasPanel(layout, panel)) return layout
  const without = removePanel(layout, panel)
  return addFloating(without, [panel], panel, bounds)
}

export function floatGroup(
  layout: LayoutState,
  groupId: string,
  bounds: { x: number; y: number; width: number; height: number },
): LayoutState {
  const group = findGroup(layout.root, groupId)
  if (!group) return layout
  const without = removeGroup(layout, groupId)
  return addFloating(without, group.tabs, group.active, bounds)
}

export function dockFloating(
  layout: LayoutState,
  floatingId: string,
  targetId: string,
  side: DockSide,
): LayoutState {
  const source = findFloating(layout, floatingId)
  if (!source) return layout
  const target = findGroup(layout.root, targetId)
  if (!target) {
    if (!layout.root) {
      const group = makeGroup(source.tabs, source.active)
      return { ...removeFloating(layout, floatingId), root: group, savedAt: Date.now() }
    }
    return layout
  }

  const without = removeFloating(layout, floatingId)
  if (side === 'center') {
    const root = updateGroup(without.root as DockNode, targetId, (group) => ({
      ...group,
      tabs: dedupePanels([...group.tabs, ...source.tabs]),
      active: source.active,
    }))
    return { ...without, root, savedAt: Date.now() }
  }

  const group = makeGroup(source.tabs, source.active)
  const rootWithout = removeGroupNode(without.root, targetId)
  if (!rootWithout) return layout
  const horizontal = side === 'left' || side === 'right'
  const sourceFirst = side === 'left' || side === 'top'
  const split = makeSplit(
    horizontal ? 'row' : 'column',
    50,
    sourceFirst ? group : target,
    sourceFirst ? target : group,
  )
  return { ...without, root: split, savedAt: Date.now() }
}

export function dockFloatingToRoot(
  layout: LayoutState,
  floatingId: string,
  side: Exclude<DockSide, 'center'>,
): LayoutState {
  const source = findFloating(layout, floatingId)
  if (!source) return layout
  const without = removeFloating(layout, floatingId)
  const group = makeGroup(source.tabs, source.active)
  if (!without.root) return { ...without, root: group, savedAt: Date.now() }
  return { ...without, root: splitRoot(without.root, side, group), savedAt: Date.now() }
}

export function groupIdOfPanel(layout: LayoutState, panel: PanelId): string | null {
  return findGroupOfPanel(layout.root, panel)?.id ?? null
}

/** Keep a persisted payload inside the set of panels the app can render. */
export function normalizeLayout(
  input: LayoutState | null,
  available: readonly PanelId[],
  focusGroupId?: string | null,
): LayoutState {
  const valid = new Set(available)
  const seen = new Set<PanelId>()

  const sanitize = (node: DockNode | null): DockNode | null => {
    if (!node) return null
    if (node.kind === 'tabs') {
      const tabs: PanelId[] = []
      for (const tab of node.tabs) {
        if (valid.has(tab) && !seen.has(tab)) {
          seen.add(tab)
          tabs.push(tab)
        }
      }
      if (tabs.length === 0) return null
      const active = tabs.includes(node.active) ? node.active : tabs[0]
      return { ...node, tabs, active }
    }
    const first = sanitize(node.first)
    const second = sanitize(node.second)
    if (!first && !second) return null
    if (!first) return second
    if (!second) return first
    return { ...node, ratio: clampRatio(node.ratio), first, second }
  }

  let root = sanitize(input?.root ?? null)

  const floating: FloatingWindow[] = []
  for (const entry of input?.floating ?? []) {
    const tabs: PanelId[] = []
    for (const tab of entry.tabs) {
      if (valid.has(tab) && !seen.has(tab)) {
        seen.add(tab)
        tabs.push(tab)
      }
    }
    if (tabs.length === 0) continue
    floating.push({
      ...entry,
      tabs,
      active: tabs.includes(entry.active) ? entry.active : tabs[0],
      x: Number.isFinite(entry.x) ? Math.round(entry.x) : 24,
      y: Number.isFinite(entry.y) ? Math.round(entry.y) : 24,
      width: Number.isFinite(entry.width) ? Math.max(280, Math.round(entry.width)) : 520,
      height: Number.isFinite(entry.height) ? Math.max(180, Math.round(entry.height)) : 420,
    })
  }

  const missing = PANEL_IDS.filter((panel) => valid.has(panel) && !seen.has(panel))
  if (!root && missing.length > 0 && !input?.root) {
    const base = createDefaultLayout(missing)
    return {
      ...base,
      floating,
      maximized: null,
    }
  }
  for (const panel of missing) {
    if (!root) {
      root = makeGroup([panel])
      seen.add(panel)
      continue
    }
    const target = (focusGroupId ? findGroup(root, focusGroupId) : null) ?? collectGroups(root)[0] ?? null
    if (!target) {
      root = makeGroup([panel])
    } else {
      root = updateGroup(root, target.id, (group) => ({
        ...group,
        tabs: [...group.tabs, panel],
        active: panel,
      }))
    }
    seen.add(panel)
  }

  if (!root && floating.length === 0 && available.length > 0) {
    return createDefaultLayout(available)
  }

  return {
    version: LAYOUT_VERSION,
    root,
    floating,
    maximized:
      root && input?.maximized && findGroup(root, input.maximized) ? input.maximized : null,
    savedAt: input?.savedAt ?? Date.now(),
  }
}

/* ------------------------------------------------------------------ */
/* Persistence + migration                                             */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readTabs(value: unknown): PanelId[] {
  if (!Array.isArray(value)) return []
  return dedupePanels(value.filter(isPanelId))
}

function coerceNode(value: unknown): DockNode | null {
  if (!isRecord(value)) return null
  const kind = value.kind === 'split' || value.type === 'split' ? 'split' : 'tabs'
  if (kind === 'split') {
    const first = coerceNode(value.first ?? (Array.isArray(value.children) ? value.children[0] : null))
    const second = coerceNode(value.second ?? (Array.isArray(value.children) ? value.children[1] : null))
    if (!first && !second) return null
    if (!first) return second
    if (!second) return first
    return {
      kind: 'split',
      id: typeof value.id === 'string' && value.id ? value.id : makeId('split'),
      direction: value.direction === 'column' ? 'column' : 'row',
      ratio: clampRatio(typeof value.ratio === 'number' ? value.ratio : 50),
      first,
      second,
    }
  }
  const tabs = readTabs(value.tabs ?? (isPanelId(value.panel) ? [value.panel] : []))
  if (tabs.length === 0) return null
  const active = isPanelId(value.active) && tabs.includes(value.active) ? value.active : tabs[0]
  return {
    kind: 'tabs',
    id: typeof value.id === 'string' && value.id ? value.id : makeId('group'),
    tabs,
    active,
  }
}

function coerceFloating(value: unknown): FloatingWindow | null {
  if (!isRecord(value)) return null
  const tabs = readTabs(value.tabs ?? (isPanelId(value.panel) ? [value.panel] : []))
  if (tabs.length === 0) return null
  const active = isPanelId(value.active) && tabs.includes(value.active) ? value.active : tabs[0]
  const num = (input: unknown, fallback: number) =>
    typeof input === 'number' && Number.isFinite(input) ? input : fallback
  return {
    id: typeof value.id === 'string' && value.id ? value.id : makeId('float'),
    tabs,
    active,
    x: num(value.x, 24),
    y: num(value.y, 24),
    width: Math.max(280, num(value.width, 520)),
    height: Math.max(180, num(value.height, 420)),
    z: num(value.z, 21),
  }
}

/** Supports the flat panel order used by older builds and the v3 tree. */
export function migrateLayout(raw: unknown): LayoutState | null {
  if (!isRecord(raw)) return null

  if (isRecord(raw.root)) {
    const root = coerceNode(raw.root)
    const floating = Array.isArray(raw.floating)
      ? raw.floating.map(coerceFloating).filter((entry): entry is FloatingWindow => Boolean(entry))
      : []
    return {
      version: LAYOUT_VERSION,
      root,
      floating,
      maximized: typeof raw.maximized === 'string' ? raw.maximized : null,
      savedAt: typeof raw.savedAt === 'number' ? raw.savedAt : Date.now(),
    }
  }

  if (Array.isArray(raw.groups)) {
    const groups = raw.groups
      .map(coerceNode)
      .filter((node): node is DockNode => Boolean(node) && node?.kind === 'tabs')
    if (groups.length > 0) {
      let root: DockNode = groups[0]
      for (let index = 1; index < groups.length; index += 1) {
        root = makeSplit('row', 50, root, groups[index])
      }
      return {
        version: LAYOUT_VERSION,
        root,
        floating: [],
        maximized: null,
        savedAt: Date.now(),
      }
    }
  }

  if (Array.isArray(raw.order)) {
    const panels = readTabs(raw.order)
    if (panels.length > 0) return createDefaultLayout(panels)
  }

  return null
}

export function loadStoredLayout(available: readonly PanelId[] = PANEL_IDS): LayoutState | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const text = localStorage.getItem(LAYOUT_STORAGE_KEY)
    if (!text) return null
    const migrated = migrateLayout(JSON.parse(text) as unknown)
    if (!migrated) return null
    return normalizeLayout(migrated, available)
  } catch {
    return null
  }
}

export function saveStoredLayout(layout: LayoutState): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(
      LAYOUT_STORAGE_KEY,
      JSON.stringify({ ...layout, version: LAYOUT_VERSION, savedAt: Date.now() }),
    )
  } catch {
    // Quota / private mode: layout persistence is best-effort.
  }
}

export function saveLayoutBackup(layout: LayoutState): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(
      LAYOUT_BACKUP_KEY,
      JSON.stringify({ ...layout, version: LAYOUT_VERSION, savedAt: Date.now() }),
    )
  } catch {
    // Best-effort.
  }
}

export function loadLayoutBackup(available: readonly PanelId[]): LayoutState | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const text = localStorage.getItem(LAYOUT_BACKUP_KEY)
    if (!text) return null
    const migrated = migrateLayout(JSON.parse(text) as unknown)
    return migrated ? normalizeLayout(migrated, available) : null
  } catch {
    return null
  }
}
