import { useState, type ReactNode } from 'react'
import { Rnd } from 'react-rnd'
import { Icon } from './Icons'

export interface WindowFrameProps {
  id: string
  title: string
  icon?: ReactNode
  initial: { x: number; y: number; width: number; height: number }
  zIndex: number
  floating?: boolean
  onFocus: () => void
  onClose: () => void
  children: ReactNode
}

const resizeHandleClasses = {
  top: 'window-frame__resize',
  right: 'window-frame__resize',
  bottom: 'window-frame__resize',
  left: 'window-frame__resize',
  topRight: 'window-frame__resize',
  bottomRight: 'window-frame__resize',
  bottomLeft: 'window-frame__resize',
  topLeft: 'window-frame__resize',
}

const windowFrameStyles = `
  .window-frame {
    --window-frame-bar-height: 44px;
    overflow: hidden;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-l);
    background: color-mix(in srgb, var(--bg) 78%, transparent);
    box-shadow: var(--shadow);
    color: var(--text);
    backdrop-filter: blur(var(--glass-blur)) saturate(140%);
    -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(140%);
  }

  .window-frame__bar {
    display: flex;
    flex: 0 0 var(--window-frame-bar-height);
    align-items: center;
    gap: 10px;
    height: var(--window-frame-bar-height);
    padding: 0 8px 0 14px;
    border-bottom: 1px solid var(--line);
    background: linear-gradient(180deg, var(--glass-bg-hover), transparent);
    cursor: grab;
    user-select: none;
    touch-action: none;
  }

  .window-frame__bar:active {
    cursor: grabbing;
  }

  .window-frame__bar-title {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    color: var(--text-strong);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .window-frame__icon {
    display: grid;
    flex: none;
    place-items: center;
    width: 20px;
    height: 20px;
    color: var(--faint);
  }

  .window-frame__icon > svg {
    display: block;
  }

  .window-frame__close {
    display: grid;
    flex: none;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-s);
    color: var(--faint);
    transition:
      color var(--dur-fast) var(--ease),
      background-color var(--dur-fast) var(--ease);
  }

  .window-frame__close:hover {
    color: var(--text-strong);
    background: var(--glass-bg-hover);
  }

  .window-frame__close:active {
    background: var(--glass-bg-active);
  }

  .window-frame__close:focus-visible {
    outline: 1px solid var(--amber-line);
    outline-offset: 1px;
  }

  .window-frame__content {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    scrollbar-color: var(--line-strong) transparent;
  }

  .window-frame__content::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }

  .window-frame__content::-webkit-scrollbar-thumb {
    border-radius: var(--radius-pill);
    background: var(--line-strong);
  }

  .window-frame__content::-webkit-scrollbar-track {
    background: transparent;
  }

  .window-frame__resize {
    z-index: 3;
    transition: background-color var(--dur-fast) var(--ease);
  }

  .window-frame__resize:hover {
    background: var(--glass-bg-hover);
  }
`

export function WindowFrame({
  id,
  title,
  icon,
  initial,
  zIndex,
  floating = false,
  onFocus,
  onClose,
  children,
}: WindowFrameProps) {
  const [isFloating, setIsFloating] = useState(floating)
  return (
    <>
      <style>{windowFrameStyles}</style>
      <Rnd
        id={id}
        className={`window-frame ${isFloating ? 'window-frame--floating' : 'window-frame--tiled'}`}
        default={initial}
        style={{
          zIndex,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        minWidth={300}
        minHeight={180}
        dragHandleClassName="window-frame__bar"
        cancel=".window-frame__close"
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
        resizeHandleClasses={resizeHandleClasses}
        onDragStart={() => setIsFloating(true)}
        onClick={onFocus}
        role="dialog"
        aria-label={title}
      >
        <header className="window-frame__bar">
          {icon ? (
            <span className="window-frame__icon" aria-hidden="true">
              {icon}
            </span>
          ) : null}
          <span className="window-frame__bar-title" title={title}>
            {title}
          </span>
          <button
            type="button"
            className="window-frame__close"
            aria-label={`关闭${title}`}
            title="关闭"
            onClick={(event) => {
              event.stopPropagation()
              onClose()
            }}
          >
            <Icon name="x" size={16} />
          </button>
        </header>
        <div className="window-frame__content">{children}</div>
      </Rnd>
    </>
  )
}
