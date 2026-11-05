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

const GAP = 8
const MIN_SPLIT = 18

interface Splits {
  column: number
  left: number
  right: number
}

type Divider = 'column' | 'left' | 'right'

function clamp(value: number, min = MIN_SPLIT, max = 100 - MIN_SPLIT) {
  return Math.max(min, Math.min(max, value))
}

/** Every visible panel fills a slot; the four-panel layout is resizable. */
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

export function TiledWorkspace({ panels, onClose, onDetach, onFocus }: TiledWorkspaceProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [order, setOrder] = useState<TileId[]>(panels.map((panel) => panel.id))
  const [drag, setDrag] = useState<{ id: TileId; x: number; y: number } | null>(null)
  const [preview, setPreview] = useState<number | null>(null)
  const [splits, setSplits] = useState<Splits>({ column: 30, left: 46, right: 38 })
  const [divider, setDivider] = useState<Divider | null>(null)
  const dragRef = useRef<{ id: TileId } | null>(null)
  const dividerRef = useRef<Divider | null>(null)

  useEffect(() => {
    const ids = panels.map((panel) => panel.id)
    setOrder((current) => {
      const kept = current.filter((id) => ids.includes(id))
      for (const id of ['capture', 'inbox', 'week', 'timeline'] as TileId[]) {
        if (!ids.includes(id) || kept.includes(id)) continue
        const preferred = ['capture', 'inbox', 'week', 'timeline'].indexOf(id)
        const insertAt = kept.findIndex(
          (item) => ['capture', 'inbox', 'week', 'timeline'].indexOf(item) > preferred,
        )
        kept.splice(insertAt < 0 ? kept.length : insertAt, 0, id)
      }
      return kept
    })
  }, [panels])

  const slots = layoutSlots(panels.length, splits)
  const byId = new Map(panels.map((panel) => [panel.id, panel]))

  const moveTo = (id: TileId, index: number) => {
    setOrder((current) => {
      const from = current.indexOf(id)
      if (from < 0 || from === index) return current
      const next = current.filter((item) => item !== id)
      next.splice(Math.min(index, next.length), 0, id)
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

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>, id: TileId) => {
    if ((event.target as HTMLElement).closest('button')) return
    event.preventDefault()
    onFocus(id)
    dragRef.current = { id }
    setDrag({ id, x: event.clientX, y: event.clientY })
    setPreview(order.indexOf(id))
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
    const target = hitSlot(event.clientX, event.clientY)
    if (target !== null) {
      setPreview(target)
      moveTo(dragRef.current.id, target)
    }
  }

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dividerRef.current) {
      dividerRef.current = null
      setDivider(null)
      return
    }
    if (!dragRef.current) return
    const root = rootRef.current
    const outside =
      !root ||
      event.clientX < root.getBoundingClientRect().left ||
      event.clientX > root.getBoundingClientRect().right ||
      event.clientY < root.getBoundingClientRect().top ||
      event.clientY > root.getBoundingClientRect().bottom
    const id = dragRef.current.id
    dragRef.current = null
    setDrag(null)
    setPreview(null)
    if (outside) onDetach(id)
  }

  return (
    <div
      className={`tiled-workspace ${drag ? 'tiled-workspace--dragging' : ''}`}
      ref={rootRef}
      onPointerMove={onPointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
    >
      {order.map((id, index) => {
        const panel = byId.get(id)
        if (!panel) return null
        const slot = slots[index] ?? slots[slots.length - 1]
        return (
          <section
            className={`tile-frame ${drag?.id === id ? 'tile-frame--dragging' : ''}`}
            key={id}
            style={toStyle(slot)}
            onPointerDown={(event) => onPointerDown(event, id)}
            aria-label={panel.title}
          >
            <header className="tile-frame__bar">
              <span className="tile-frame__icon">{panel.icon}</span>
              <span className="tile-frame__title">{panel.title}</span>
              <button
                type="button"
                className="tile-frame__action"
                title="放到独立窗口"
                aria-label={`把${panel.title}放到独立窗口`}
                onClick={() => onDetach(id)}
              >
                <Icon name="external" size={12} />
              </button>
              <button
                type="button"
                className="tile-frame__action"
                title="关闭"
                aria-label={`关闭${panel.title}`}
                onClick={() => onClose(id)}
              >
                <Icon name="x" size={13} />
              </button>
            </header>
            <div className="tile-frame__content">{panel.content}</div>
          </section>
        )
      })}

      {!drag && panels.length >= 3 && (
        <button
          type="button"
          className={`tile-divider tile-divider--column ${divider === 'column' ? 'is-active' : ''}`}
          style={{ left: `calc(${splits.column}% - 4px)` }}
          onPointerDown={(event) => onDividerDown(event, 'column')}
          aria-label="拖动调整左右比例"
        />
      )}
      {!drag && panels.length === 3 && (
        <button
          type="button"
          className={`tile-divider tile-divider--row ${divider === 'left' ? 'is-active' : ''}`}
          style={{ top: `calc(${splits.left}% - 4px)`, width: `calc(${splits.column}% - 4px)` }}
          onPointerDown={(event) => onDividerDown(event, 'left')}
          aria-label="拖动调整左侧上下比例"
        />
      )}
      {!drag && panels.length === 4 && (
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
          {byId.get(drag.id)?.title}
        </div>
      )}
    </div>
  )
}
