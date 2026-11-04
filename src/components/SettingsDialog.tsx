import { useState } from 'react'
import type { AppSettings } from '../types'
import {
  PROVIDERS,
  fetchModels,
  findProviderByBaseUrl,
  type ModelInfo,
} from '../lib/providers'
import { Icon } from './Icons'

type SettingsTab = 'ai' | 'sync' | 'reminders' | 'data'

interface SettingsDialogProps {
  settings: AppSettings
  apiKey: string
  githubToken: string
  syncBusy: boolean
  syncMessage: string
  onClose: () => void
  onSave: (settings: AppSettings, apiKey: string, githubToken: string) => void
  onSync: (settings: AppSettings, githubToken: string) => void
  onExport: () => void
  onImport: (file: File) => void
  onClear: () => void
  onOpenConnect: () => void
  notificationsOn: boolean
  notificationStatus: string
  onToggleNotifications: () => void
  onOpenExactAlarm: () => void
  embedded?: boolean
}

export function SettingsDialog({
  settings,
  apiKey,
  githubToken,
  syncBusy,
  syncMessage,
  onClose,
  onSave,
  onSync,
  onExport,
  onImport,
  onClear,
  onOpenConnect,
  notificationsOn,
  notificationStatus,
  onToggleNotifications,
  onOpenExactAlarm,
  embedded = false,
}: SettingsDialogProps) {
  const [tab, setTab] = useState<SettingsTab>('ai')
  const [form, setForm] = useState(settings)
  const [modelKey, setModelKey] = useState(apiKey)
  const [repoToken, setRepoToken] = useState(githubToken)
  const [showKey, setShowKey] = useState(false)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState('')
  const provider = findProviderByBaseUrl(form.baseUrl)

  const set = <K extends keyof AppSettings>(field: K, value: AppSettings[K]) => {
    setForm((current) => ({ ...current, [field]: value }))
  }

  const save = () => onSave(form, modelKey, repoToken)

  const loadModels = async () => {
    setModelsLoading(true)
    setModelsError('')
    try {
      const list = await fetchModels(form.baseUrl, modelKey)
      setModels(list)
      if (!form.model) set('model', list[0].id)
    } catch (error) {
      setModels([])
      setModelsError(error instanceof Error ? error.message : '获取模型失败')
    } finally {
      setModelsLoading(false)
    }
  }

  return (
    <div
      className={embedded ? 'settings-embedded' : 'modal-backdrop'}
      onMouseDown={embedded ? undefined : onClose}
    >
      <div
        className={embedded ? 'settings-dialog settings-dialog--embedded' : 'settings-dialog'}
        role="dialog"
        aria-modal={embedded ? undefined : true}
        aria-label="设置"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-dialog__head">
          <div>
            <p className="eyebrow">设置</p>
            <h2>让时间流过你的方式</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭设置">
            <Icon name="x" size={19} />
          </button>
        </header>

        <div className="settings-tabs" role="tablist">
          <button
            className={tab === 'ai' ? 'is-active' : ''}
            onClick={() => setTab('ai')}
            role="tab"
            aria-selected={tab === 'ai'}
            type="button"
          >
            模型接口
          </button>
          <button
            className={tab === 'sync' ? 'is-active' : ''}
            onClick={() => setTab('sync')}
            role="tab"
            aria-selected={tab === 'sync'}
            type="button"
          >
            多设备同步
          </button>
          <button
            className={tab === 'reminders' ? 'is-active' : ''}
            onClick={() => setTab('reminders')}
            role="tab"
            aria-selected={tab === 'reminders'}
            type="button"
          >
            提醒
          </button>
          <button
            className={tab === 'data' ? 'is-active' : ''}
            onClick={() => setTab('data')}
            role="tab"
            aria-selected={tab === 'data'}
            type="button"
          >
            数据
          </button>
        </div>

        <div className="settings-body">
          {tab === 'ai' && (
            <>
              <p className="settings-lede">
                默认使用 DeepSeek。也支持 OpenAI Chat Completions 兼容接口；填入你信任的端点与模型，内容会直接从设备发出。
              </p>
              <label className="field">
                <span>模型提供商</span>
                <select
                  className="provider-select"
                  value={provider?.id ?? 'custom'}
                  onChange={(event) => {
                    const next = PROVIDERS.find((item) => item.id === event.target.value)
                    if (next) {
                      set('baseUrl', next.baseUrl)
                      setModels([])
                      setModelsError('')
                    }
                  }}
                >
                  <option value="custom">自定义接口</option>
                  {PROVIDERS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <small>{provider?.note ?? '填写任意兼容 OpenAI 的接口地址。'}</small>
              </label>
              <label className="field">
                <span>接口地址</span>
                <input
                  value={form.baseUrl}
                  onChange={(event) => set('baseUrl', event.target.value)}
                  placeholder="https://api.deepseek.com/v1"
                  spellCheck={false}
                />
                <small>自动补全 /chat/completions；也可填写完整地址。</small>
              </label>
              <div className="field">
                <span>模型</span>
                <div className="field__row">
                  <input
                    value={form.model}
                    onChange={(event) => set('model', event.target.value)}
                    placeholder="deepseek-chat"
                    spellCheck={false}
                  />
                  <button
                    className="text-button text-button--outline"
                    type="button"
                    onClick={() => void loadModels()}
                    disabled={modelsLoading}
                  >
                    {modelsLoading ? '获取中…' : '获取模型'}
                  </button>
                </div>
                <small>先填 API Key，再点“获取模型”，从列表里选择。</small>
                {modelsError && <p className="model-error">{modelsError}</p>}
                {models.length > 0 && (
                  <div className="model-picker">
                    {models.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={form.model === item.id ? 'is-selected' : ''}
                        onClick={() => set('model', item.id)}
                        title={item.ownedBy ? `${item.id} · ${item.ownedBy}` : item.id}
                      >
                        {item.id}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <label className="field">
                <span>API Key</span>
                <div className="field__secret">
                  <input
                    value={modelKey}
                    onChange={(event) => setModelKey(event.target.value)}
                    type={showKey ? 'text' : 'password'}
                    placeholder="sk-..."
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <button className="text-button" onClick={() => setShowKey((value) => !value)} type="button">
                    {showKey ? '隐藏' : '显示'}
                  </button>
                </div>
                <small>
                  <Icon name="lock" size={12} /> 保存在本机 localStorage，关闭应用后仍保留；请只在个人设备使用。
                </small>
              </label>
              <div className="notice">
                <Icon name="alert" size={15} />
                <p>
                  公开软件不应内置厂商密钥。桌面端与手机端后续会改由系统钥匙串保管；若接口不允许浏览器跨域，请使用桌面端或自建代理。
                </p>
              </div>
            </>
          )}

          {tab === 'sync' && (
            <>
              <p className="settings-lede">
                日程写进你自己的 GitHub 私有仓库，不经过第三方服务器。这是参考 DarkCube 的 local-first
                方案，但改为事件级合并，不再让远端覆盖本地。
              </p>
              <button
                className="github-connect-banner"
                type="button"
                onClick={() => {
                  save()
                  onOpenConnect()
                }}
              >
                <span className="github-connect-banner__mark">
                  <Icon name="github" size={21} />
                </span>
                <span className="github-connect-banner__text">
                  <strong>{githubToken ? '已连接 GitHub，换一个仓库' : '用 GitHub 网页登录'}</strong>
                  <small>图形化授权 / 自动读取私有仓库 / 一键创建同步仓库</small>
                </span>
                <Icon name="arrow-right" size={17} />
              </button>
              <div className="field-grid">
                <label className="field">
                  <span>GitHub 用户名</span>
                  <input
                    value={form.githubOwner}
                    onChange={(event) => set('githubOwner', event.target.value)}
                    placeholder="your-name"
                    spellCheck={false}
                  />
                </label>
                <label className="field">
                  <span>私有仓库</span>
                  <input
                    value={form.githubRepo}
                    onChange={(event) => set('githubRepo', event.target.value)}
                    placeholder="lanshan-schedule"
                    spellCheck={false}
                  />
                </label>
              </div>
              <div className="field-grid">
                <label className="field">
                  <span>分支</span>
                  <input
                    value={form.githubBranch}
                    onChange={(event) => set('githubBranch', event.target.value)}
                    placeholder="main"
                    spellCheck={false}
                  />
                </label>
                <label className="field">
                  <span>Fine-grained Token</span>
                  <input
                    value={repoToken}
                    onChange={(event) => setRepoToken(event.target.value)}
                    type="password"
                    placeholder="github_pat_..."
                    spellCheck={false}
                    autoComplete="off"
                  />
                </label>
              </div>
              <label className="field">
                <span>OAuth App Client ID（可选，开发者配置）</span>
                <input
                  value={form.githubClientId}
                  onChange={(event) => set('githubClientId', event.target.value)}
                  placeholder="留空使用内置 Client ID"
                  spellCheck={false}
                />
                <small>留空使用应用内置的公开 Client ID；填自己的可覆盖。client secret 不会进入客户端。</small>
              </label>
              <div className="notice">
                <Icon name="keyboard" size={15} />
                <p>
                  手动 Token 只勾选该仓库的 <strong>Contents: Read and write</strong> 即可。Token
                  同样只存于本次会话。仓库里会生成 <code>schedule.json</code>。
                </p>
              </div>
              <div className="sync-row">
                <button
                  className="ghost-button"
                  onClick={() => {
                    save()
                    onSync(form, repoToken)
                  }}
                  disabled={syncBusy || !form.githubOwner || !form.githubRepo || !repoToken}
                  type="button"
                >
                  <Icon name={syncBusy ? 'refresh' : 'cloud'} size={16} />
                  {syncBusy ? '正在同步…' : '验证并同步'}
                </button>
                {syncMessage && <span className="sync-row__message">{syncMessage}</span>}
              </div>
            </>
          )}

          {tab === 'reminders' && (
            <>
              <p className="settings-lede">
                在日程开始前 10 分钟提醒。Android 端会申请通知权限；ColorOS 还需要允许后台行为和自启动，提醒才稳定。
              </p>
              <div className="reminder-card">
                <div className="reminder-card__text">
                  <strong>日程提醒</strong>
                  <small>当前设备：Android / iOS 原生端可用，网页版不可用</small>
                </div>
                <button
                  className={`switch ${notificationsOn ? 'switch--on' : ''}`}
                  type="button"
                  role="switch"
                  aria-checked={notificationsOn}
                  onClick={onToggleNotifications}
                >
                  <span />
                </button>
              </div>
              <div className="notice">
                <Icon name="clock" size={15} />
                <p>
                  若需要“准点响铃”，还需要在系统设置里授予<strong>闹钟和提醒</strong>权限。没有授权时，系统可能把提醒延后。
                </p>
              </div>
              <button className="ghost-button" type="button" onClick={onOpenExactAlarm}>
                <Icon name="settings" size={15} />
                打开系统精确闹钟设置
              </button>
              {notificationStatus && <p className="sync-row__message">{notificationStatus}</p>}
            </>
          )}

          {tab === 'data' && (
            <>
              <p className="settings-lede">
                所有日程默认留在这台设备。你可以随时导出为统一 JSON，或带到另一台设备。
              </p>
              <div className="data-actions">
                <button className="data-action" onClick={onExport} type="button">
                  <span className="data-action__icon">
                    <Icon name="download" size={18} />
                  </span>
                  <span>
                    <strong>导出 schedule.json</strong>
                    <small>包含全部事件、时区与同步字段</small>
                  </span>
                  <Icon name="arrow-right" size={16} />
                </button>
                <label className="data-action">
                  <span className="data-action__icon">
                    <Icon name="json" size={18} />
                  </span>
                  <span>
                    <strong>导入 JSON</strong>
                    <small>事件级合并，不会覆盖同 id 的新版本</small>
                  </span>
                  <Icon name="arrow-right" size={16} />
                  <input
                    type="file"
                    accept="application/json,.json"
                    hidden
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      if (file) onImport(file)
                      event.currentTarget.value = ''
                    }}
                  />
                </label>
              </div>
              <div className="danger-zone">
                <div>
                  <strong>清空这台设备</strong>
                  <p>只删除本地数据；已同步到 GitHub 的内容仍保留。</p>
                </div>
                <button
                  className="text-button text-button--danger"
                  onClick={() => {
                    if (window.confirm('确定清空这台设备上的全部日程吗？')) onClear()
                  }}
                  type="button"
                >
                  <Icon name="trash" size={15} />
                  清空
                </button>
              </div>
            </>
          )}
        </div>

        <footer className="settings-dialog__foot">
          <span>本地优先 · 开放格式 · 不锁定</span>
          <div>
            <button className="ghost-button" onClick={onClose} type="button">
              取消
            </button>
            <button
              className="primary-button primary-button--small"
              onClick={() => {
                save()
                onClose()
              }}
              type="button"
            >
              保存设置
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
