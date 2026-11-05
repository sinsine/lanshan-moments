import { useEffect } from 'react'
import { APP_VERSION } from '../lib/config'
import { CHANGELOG, releaseUrl } from '../lib/changelog'
import { openExternal } from '../lib/native'
import { Icon } from './Icons'

interface ChangelogDialogProps {
  open: boolean
  onClose: () => void
}

export function ChangelogDialog({ open, onClose }: ChangelogDialogProps) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="modal-backdrop changelog-backdrop"
      onMouseDown={onClose}
      role="presentation"
    >
      <div
        className="changelog-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="更新日志"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="changelog-dialog__head">
          <div className="changelog-dialog__titles">
            <p className="eyebrow">更新日志</p>
            <h2>一路走来的光</h2>
            <p className="changelog-dialog__sub">
              当前版本 <strong>v{APP_VERSION}</strong> · 每次更新都在这条时间轴上留下痕迹
            </p>
          </div>
          <button
            type="button"
            className="icon-button changelog-dialog__close"
            onClick={onClose}
            aria-label="关闭更新日志"
          >
            <Icon name="x" size={18} />
          </button>
        </header>

        <div className="changelog-body">
          {CHANGELOG.map((entry) => (
            <section className="changelog-entry" key={entry.version}>
              <div className="changelog-entry__head">
                <button
                  type="button"
                  className="changelog-entry__version"
                  onClick={() => void openExternal(releaseUrl(entry.version))}
                  title="在浏览器中查看这个版本"
                >
                  v{entry.version}
                </button>
                <span className="changelog-entry__date">{entry.date}</span>
                {entry.version === APP_VERSION ? (
                  <span className="changelog-entry__badge">当前</span>
                ) : null}
                <button
                  type="button"
                  className="changelog-entry__link"
                  onClick={() => void openExternal(releaseUrl(entry.version))}
                >
                  查看 Release
                </button>
              </div>
              <ul className="changelog-entry__notes">
                {entry.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <footer className="changelog-dialog__foot">
          <span>完整发布说明与安装包在 GitHub Releases</span>
          <button
            type="button"
            className="text-button text-button--outline"
            onClick={() => void openExternal(`${releaseUrl(APP_VERSION)}`)}
          >
            打开当前版本
            <Icon name="external" size={13} />
          </button>
        </footer>
      </div>
    </div>
  )
}
