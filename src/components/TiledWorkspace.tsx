import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Icon } from './Icons'

export type TileId = 'capture' | 'week' | 'timeline' | 'inbox'

export interface TilePanel {
  id: TileId
  title: string
  icon: ReactNode
  content: ReactNode
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

interface TiledWorkspaceProps {
  panels: TilePanel[]
  onClose: (id: TileId) => void
  onDetach: (id: TileId) => void
  onFocus: (id: TileId) => void
}

interface Group {
  id: string
  tabs: TileId[]
  active: TileId
}

interface Splits {
  column: number
  left: number
  right: number
}

type Divider = 'column' | 'left' | 'right'

const GAP = 8
const MIN_SPLIT = 18
const PREFERRED: TileId[] = ['capture', 'inbox', 'week', 'timeline']

function clamp(value: number, min = MIN_SPLIT, max = 100 - MIN_SPLIT) {
  return Math.max(min, Math.min(max, value))
}

function layoutSlots(count: number, splits: Splits): Rect[] {
  if (count <= 1) return [{ x: 0, y: 0, w: 100, h: 100 }]
  if (count === 2) {
    return [
      { x: 0, y: 0, w: 50, h: 100 },
      { x: 50, y: 0, w: 50, h: 100 },
    ]
  }
  if (count === 3) {
    return [
      { x: 0, y: 0, w: splits.column, h: splits.left },
      { x: 0, y: splits.left, w: splits.column, h: 100 - splits.left },
      { x: splits.column, y: 0, w: 100 - splits.column, h: 100 },
    ]
  }
  return [
    { x: 0, y: 0, w: splits.column, h: splits.left },
    { x: 0, y: splits.left, w: splits.column, h: 100 - splits.left },
    { x: splits.column, y: 0, w: 100 - splits.column, h: splits.right },
    { x: splits.column, y: splits.right, w: 100 - splits.column, h: 100 - splits.right },
  ]
}

function toStyle(rect: Rect) {
  const gap = `calc(${GAP}px / 2)`
  return {
    left: `calc(${rect.x}% + ${gap})`,
    top: `calc(${rect.y}% + ${gap})`,
    width: `calc(${rect.w}% - ${GAP}px)`,
    height: `calc(${rect.h}% - ${GAP}px)`,
  }
}

function makeGroups(panels: TilePanel[]): Group[] {
  return panels.map((panel) => ({ id: `group-${panel.id}`, tabs: [panel.id], active: panel.id }))
}

export function TiledWorkspace({ panels, onClose, onDetach, onFocus }: TiledWorkspaceProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [groups, setGroups] = useState<Group[]>(() => makeGroups(panels))
  const [drag, setDrag] = useState<{ groupId: string; x: number; y: number } | null>(null)
  const [mergeTarget, setMergeTarget] = useState<string | null>(null)
  const [preview, setPreview] = useState<number | null>(null)
  const [splits, setSplits] = useState<Splits>({ column: 30, left: 46, right: 38 })
  const [divider, setDivider] = useState<Divider | null>(null)
  const dragRef = useRef<string | null>(null)
  const dividerRef = useRef<Divider | null>(null)
  const mergeRef = useRef<string | null>(null)

  useEffect(() => {
    const ids = panels.map((panel) => panel.id)
    setGroups((current) => {
      const next = current
        .map((group) => {
          const tabs = group.tabs.filter((id) => ids.includes(id))
          return {
            ...group,
            tabs,
            active: tabs.includes(group.active) ? group.active : tabs[0],
          }
        })
        .filter((group) => group.tabs.length > 0)

      for (const id of PREFERRED) {
        if (!ids.includes(id) || next.some((group) => group.tabs.includes(id))) continue
        const preferred = PREFERRED.indexOf(id)
        const at = next.findIndex((group) =>
          group.tabs.some((tab) => PREFERRED.indexOf(tab) > preferred),
        )
        next.splice(at < 0 ? next.length : at, 0, {
          id: `group-${id}`,
          tabs: [id],
          active: id,
        })
      }
      return next
    })
  }, [panels])

  const slots = layoutSlots(groups.length, splits)
  const byId = new Map(panels.map((panel) => [panel.id, panel]))

  const moveGroup = (id: string, index: number) => {
    setGroups((current) => {
      const from = current.findIndex((group) => group.id === id)
      if (from < 0 || from === index) return current
      const next = [...current]
      const [group] = next.splice(from, 1)
      next.splice(Math.min(index, next.length), 0, group)
      return next
    })
  }

  const hitSlot = (clientX: number, clientY: number): number | null => {
    const root = rootRef.current
    if (!root) return null
    const bounds = root.getBoundingClientRect()
    const rx = ((clientX - bounds.left) / bounds.width) * 100
    const ry = ((clientY - bounds.top) / bounds.height) * 100
    for (let index = 0; index < slots.length; index += 1) {
      const slot = slots[index]
      if (rx >= slot.x && rx <= slot.x + slot.w && ry >= slot.y && ry <= slot.y + slot.h) {
        return index
      }
    }
    return null
  }

  const headerGroupAt = (clientX: number, clientY: number): string | null => {
    const element = document.elementFromPoint(clientX, clientY)
    const bar = element?.closest('.tile-frame__bar') as HTMLElement | null
    const section = bar?.closest('[data-group]') as HTMLElement | null
    return section?.dataset.group ?? null
  }

  const removeTab = (groupId: string, id: TileId, detach = false) => {
    setGroups((current) =>
      current
        .map((group) => {
          if (group.id !== groupId) return group
          const tabs = group.tabs.filter((tab) => tab !== id)
          return {
            ...group,
            tabs,
            active: tabs.includes(group.active) ? group.active : tabs[0],
          }
        })
        .filter((group) => group.tabs.length > 0),
    )
    if (detach) onDetach(id)
    else onClose(id)
  }

  const startGroupDrag = (event: ReactPointerEvent<HTMLElement>, group: Group) => {
    if ((event.target as HTMLElement).closest('button')) return
    event.preventDefault()
    onFocus(group.active)
    dragRef.current = group.id
    setDrag({ groupId: group.id, x: event.clientX, y: event.clientY })
    setPreview(groups.findIndex((item) => item.id === group.id))
    rootRef.current?.setPointerCapture(event.pointerId)
  }

  const onDividerDown = (event: ReactPointerEvent<HTMLButtonElement>, type: Divider) => {
    event.preventDefault()
    event.stopPropagation()
    dividerRef.current = type
    setDivider(type)
    rootRef.current?.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const root = rootRef.current
    if (dividerRef.current && root) {
      const bounds = root.getBoundingClientRect()
      const x = ((event.clientX - bounds.left) / bounds.width) * 100
      const y = ((event.clientY - bounds.top) / bounds.height) * 100
      const type = dividerRef.current
      setSplits((current) => ({
        ...current,
        ...(type === 'column'
          ? { column: clamp(x) }
          : type === 'left'
            ? { left: clamp(y) }
            : { right: clamp(y) }),
      }))
      return
    }
    if (!dragRef.current) return

    setDrag((current) => (current ? { ...current, x: event.clientX, y: event.clientY } : current))
    const overBar = headerGroupAt(event.clientX, event.clientY)
    if (overBar && overBar !== dragRef.current) {
      mergeRef.current = overBar
      setMergeTarget(overBar)
      return
    }
    mergeRef.current = null
    setMergeTarget(null)
    const target = hitSlot(event.clientX, event.clientY)
    if (target !== null) {
      setPreview(target)
      moveGroup(dragRef.current, target)
    }
  }

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dividerRef.current) {
      dividerRef.current = null
      setDivider(null)
      return
    }
    const draggedId = dragRef.current
    if (!draggedId) return
    const targetId = mergeRef.current
    const root = rootRef.current
    const outside =
      !root ||
      event.clientX < root.getBoundingClientRect().left ||
      event.clientX > root.getBoundingClientRect().right ||
      event.clientY < root.getBoundingClientRect().top ||
      event.clientY > root.getBoundingClientRect().bottom

    const source = groups.find((group) => group.id === draggedId)
    dragRef.current = null
    mergeRef.current = null
    setDrag(null)
    setMergeTarget(null)
    setPreview(null)
    if (!source) return

    if (targetId && targetId !== draggedId) {
      setGroups((current) => {
        const target = current.find((group) => group.id === targetId)
        if (!target) return current
        const tabs = Array.from(new Set([...target.tabs, ...source.tabs]))
        return current
          .filter((group) => group.id !== draggedId)
          .map((group) =>
            group.id === targetId
              ? { ...group, tabs, active: source.active }
              : group,
          )
      })
      return
    }

    if (outside) {
      removeTab(draggedId, source.active, true)
    }
  }

  return (
    <div
      className={`tiled-workspace ${drag ? 'tiled-workspace--dragging' : ''}`}
      ref={rootRef}
      onPointerMove={onPointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
    >
      {groups.map((group, index) => {
        const active = byId.get(group.active)
        if (!active) return null
        const slot = slots[index] ?? slots[slots.length - 1]
        return (
          <section
            className={`tile-frame ${drag?.groupId === group.id ? 'tile-frame--dragging' : ''} ${
              mergeTarget === group.id ? 'tile-frame--merge-target' : ''
            }`}
            key={group.id}
            data-group={group.id}
            style={toStyle(slot)}
            onPointerDown={(event) => startGroupDrag(event, group)}
            aria-label={active.title}
          >
            <header className="tile-frame__bar">
              {group.tabs.length > 1 ? (
                <div className="tile-frame__tabs" role="tablist">
                  {group.tabs.map((id) => {
                    const panel = byId.get(id)
                    if (!panel) return null
                    return (
                      <button
                        type="button"
                        role="tab"
                        aria-selected={id === group.active}
                        className={`tile-frame__tab ${id === group.active ? 'is-active' : ''}`}
                        key={id}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => {
                          setGroups((current) =>
                            current.map((item) =>
                              item.id === group.id ? { ...item, active: id } : item,
                            ),
                          )
                          onFocus(id)
                        }}
                      >
                        {panel.title}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <>
                  <span className="tile-frame__icon">{active.icon}</span>
                  <span className="tile-frame__title">{active.title}</span>
                </>
              )}
              <button
                type="button"
                className="tile-frame__action"
                title="放到独立窗口"
                aria-label={`把${active.title}放到独立窗口`}
                onClick={() => removeTab(group.id, group.active, true)}
              >
                <Icon name="external" size={12} />
              </button>
              <button
                type="button"
                className="tile-frame__action"
                title="关闭"
                aria-label={`关闭${active.title}`}
                onClick={() => removeTab(group.id, group.active)}
              >
                <Icon name="x" size={13} />
              </button>
            </header>
            <div className="tile-frame__content">{active.content}</div>
          </section>
        )
      })}

      {!drag && groups.length >= 3 && (
        <button
          type="button"
          className={`tile-divider tile-divider--column ${divider === 'column' ? 'is-active' : ''}`}
          style={{ left: `calc(${splits.column}% - 4px)` }}
          onPointerDown={(event) => onDividerDown(event, 'column')}
          aria-label="拖动调整左右比例"
        />
      )}
      {!drag && groups.length === 3 && (
        <button
          type="button"
          className={`tile-divider tile-divider--row ${divider === 'left' ? 'is-active' : ''}`}
          style={{ top: `calc(${splits.left}% - 4px)`, width: `calc(${splits.column}% - 4px)` }}
          onPointerDown={(event) => onDividerDown(event, 'left')}
          aria-label="拖动调整左侧上下比例"
        />
      )}
      {!drag && groups.length === 4 && (
        <>
          <button
            type="button"
            className={`tile-divider tile-divider--row ${divider === 'left' ? 'is-active' : ''}`}
            style={{ top: `calc(${splits.left}% - 4px)`, width: `calc(${splits.column}% - 4px)` }}
            onPointerDown={(event) => onDividerDown(event, 'left')}
            aria-label="拖动调整左侧上下比例"
          />
          <button
            type="button"
            className={`tile-divider tile-divider--row ${divider === 'right' ? 'is-active' : ''}`}
            style={{
              top: `calc(${splits.right}% - 4px)`,
              left: `calc(${splits.column}% + 4px)`,
              width: `calc(${100 - splits.column}% - 8px)`,
            }}
            onPointerDown={(event) => onDividerDown(event, 'right')}
            aria-label="拖动调整右侧上下比例"
          />
        </>
      )}
      {drag && preview !== null && (
        <div className="tile-preview" style={toStyle(slots[preview])} aria-hidden="true" />
      )}
      {drag && (
        <div className="tile-ghost" style={{ left: drag.x, top: drag.y }}>
          {byId.get(groups.find((group) => group.id === drag.groupId)?.active ?? 'capture')?.title}
        </div>
      )}
    </div>
  )
}
