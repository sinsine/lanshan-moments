import { useRef, useState } from 'react'
import type { AttachedImage } from '../types'
import { Icon } from './Icons'

interface CapturePanelProps {
  value: string
  onChange: (value: string) => void
  image: AttachedImage | null
  onImage: (file: File) => void
  onRemoveImage: () => void
  onParse: () => void
  onSample: () => void
  parsing: boolean
  stage: string
  hasAiKey: boolean
  model: string
  onOpenSettings: () => void
  compact?: boolean
}

export function CapturePanel({
  value,
  onChange,
  image,
  onImage,
  onRemoveImage,
  onParse,
  onSample,
  parsing,
  stage,
  hasAiKey,
  model,
  onOpenSettings,
  compact = false,
}: CapturePanelProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const canParse = Boolean(value.trim() || image) && !parsing

  return (
    <div className={`capture ${compact ? 'capture--compact' : ''}`}>
      <div className="capture__intro">
        <p className="eyebrow">收集</p>
        <h1>
          把时间
          <br />
          说给我听
        </h1>
        <p className="capture__lede">
          一段话、一张截图、一篇备忘。
          <br />
          剩下的交给它。
        </p>
      </div>

      <div
        className={`composer ${dragging ? 'composer--dragging' : ''}`}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          const file = event.dataTransfer.files[0]
          if (file) onImage(file)
        }}
      >
        <textarea
          className="composer__textarea"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onPaste={(event) => {
            const file = Array.from(event.clipboardData.files)[0]
            if (file?.type.startsWith('image/')) {
              event.preventDefault()
              onImage(file)
            }
          }}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && canParse) {
              event.preventDefault()
              onParse()
            }
          }}
          placeholder={'例如：\n本周五上午9点，周会（线上），大概一小时。\n下周三下午3点到4点半，产品评审，3楼会议室。'}
          rows={compact ? 4 : 7}
          aria-label="输入或粘贴时间安排"
        />

        {image && (
          <div className="attachment">
            <img src={image.dataUrl} alt="" />
            <div className="attachment__meta">
              <span>{image.name}</span>
              <small>
                {image.width} × {image.height}
              </small>
            </div>
            <button className="icon-button icon-button--small" onClick={onRemoveImage} aria-label="移除图片">
              <Icon name="x" size={15} />
            </button>
          </div>
        )}

        {dragging && <div className="composer__drop">松手，把这张图交给我</div>}

        <div className="composer__toolbar">
          <button
            className="text-button"
            onClick={() => inputRef.current?.click()}
            type="button"
            title="添加截图"
          >
            <Icon name="image" size={17} />
            截图
          </button>
          <button className="text-button" onClick={onSample} type="button">
            <Icon name="wand" size={16} />
            示例
          </button>
          <span className="composer__count">{value.length > 0 ? `${value.length} 字` : ''}</span>
          <button
            className="parse-button"
            onClick={onParse}
            disabled={!canParse}
            type="button"
            aria-label="整理成日程"
          >
            {parsing ? <span className="spinner spinner--dark" /> : <Icon name="arrow-up" size={19} />}
          </button>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) onImage(file)
            event.currentTarget.value = ''
          }}
        />
      </div>

      {parsing ? (
        <div className="parse-status" role="status">
          <span className="pulse-dot" />
          <span>{stage}</span>
          <span className="parse-status__line" />
        </div>
      ) : (
        <button className="engine-row" onClick={onOpenSettings} type="button">
          <span className={`engine-dot ${hasAiKey ? 'engine-dot--on' : ''}`} />
          <span className="engine-row__label">
            {hasAiKey ? (
              <>
                由 <strong>{model || '大模型'}</strong> 整理
              </>
            ) : (
              <>离线规则解析 · 可接入任意 OpenAI 兼容模型</>
            )}
          </span>
          <Icon name="settings" size={15} />
        </button>
      )}

      <div className="capture__footnote">
        <Icon name="lock" size={13} />
        内容只发送到你配置的模型端点，不经过阑珊的服务器。
      </div>

      {!compact && (
        <div className="capture__signal" aria-hidden="true">
          <span>N</span>
          <span>E</span>
          <span>W</span>
          <span>S</span>
        </div>
      )}
    </div>
  )
}
