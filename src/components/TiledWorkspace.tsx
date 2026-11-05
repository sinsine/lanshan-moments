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

/** Four, three, two and one-panel layouts. Every slot fills the workspace. */
function layoutSlots(count: number): Rect[] {
  if (count <= 1) return [{ x: 0, y: 0, w: 100, h: 100 }]
  if (count === 2) {
    return [
      { x: 0, y: 0, w: 50, h: 100 },
      { x: 50, y: 0, w: 50, h: 100 },
    ]
  }
  if (count === 3) {
    return [
      { x: 0, y: 0, w: 32, h: 50 },
      { x: 0, y: 50, w: 32, h: 50 },
      { x: 32, y: 0, w: 68, h: 100 },
    ]
  }
  return [
    { x: 0, y: 0, w: 30, h: 46 },
    { x: 0, y: 46, w: 30, h: 54 },
    { x: 30, y: 0, w: 70, h: 38 },
    { x: 30, y: 38, w: 70, h: 62 },
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
  const dragRef = useRef<{ id: TileId } | null>(null)

  useEffect(() => {
    const ids = panels.map((panel) => panel.id)
    setOrder((current) => {
      const kept = current.filter((id) => ids.includes(id))
      const added = ids.filter((id) => !kept.includes(id))
      return [...kept, ...added]
    })
  }, [panels])

  const slots = layoutSlots(panels.length)
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

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    setDrag((current) => (current ? { ...current, x: event.clientX, y: event.clientY } : current))
    const target = hitSlot(event.clientX, event.clientY)
    if (target !== null) {
      setPreview(target)
      moveTo(dragRef.current.id, target)
    }
  }

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
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
