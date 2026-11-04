import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createPrivateRepo,
  getGitHubUser,
  listPrivateRepos,
  pollDeviceFlow,
  startDeviceFlow,
  type GitHubDeviceStart,
  type GitHubRepoSummary,
  type GitHubUser,
} from '../lib/github-auth'
import { copyText } from '../lib/storage'
import { openExternal } from '../lib/native'
import { Icon } from './Icons'

/**
 * Every visible string lives here so the dialog can be translated later
 * without touching layout code.
 */
const COPY = {
  eyebrow: 'GitHub 连接',
  title: '把日程放进你的仓库',
  lede: '日程只会写进你自己的 GitHub 私有仓库，不经过第三方服务器。',
  close: '关闭',
  cancel: '取消',
  back: '返回',
  switchAccount: '换一个账号',
  escHint: '按 Esc 关闭',
  stepLabel: '连接步骤',
  stepLogin: '登录',
  stepRepo: '选择仓库',
  stepDone: '完成',
  booting: '正在用已保存的令牌连接 GitHub…',
  entry: {
    oauthTitle: '使用 GitHub 登录',
    oauthBody: '在浏览器里确认一组设备码即可授权，不需要填写任何密钥。',
    oauthStarting: '正在向 GitHub 申请设备码…',
    clientIdMissing:
      '开发提示：尚未配置 VITE_GITHUB_CLIENT_ID，设备码登录暂不可用。请在环境变量中填入 OAuth App 的 Client ID，或改用下面的访问令牌。',
    patTitle: '使用访问令牌',
    patBody: '用 Fine-grained token 连接，适合 Client ID 还没有配置的时候。',
    security: '两种方式都不会把令牌写进仓库，令牌保存在本机，更新应用后仍会保留。',
  },
  device: {
    codeLabel: '设备码',
    lede: '先复制设备码，再在 GitHub 授权页里粘贴并确认。',
    copy: '复制代码',
    copied: '已复制',
    copyFailed: '自动复制失败，请手动选中设备码。',
    expiry: (minutes: number) => `设备码约 ${minutes} 分钟内有效，过期后需要重新开始。`,
    open: '打开 GitHub 授权页',
    waiting: '等待你在 GitHub 上授权…',
    retry: '重新获取设备码',
    cancel: '取消登录',
  },
  pat: {
    lede: '按下面三步生成一个只够同步日程的令牌。',
    step1Title: '新建 Fine-grained token',
    step1Body: '在 GitHub 设置页创建 Personal access token。',
    step1Link: '打开 Token 创建页',
    step2Title: '只授予必要权限',
    step2Body: '选中要同步的私有仓库；Repository permissions 只勾选 Contents: Read and write。',
    step3Title: '粘贴并验证',
    step3Body: '令牌通常以 github_pat_ 开头，验证通过后会读取你的私有仓库。',
    fieldLabel: '访问令牌',
    placeholder: 'github_pat_…',
    show: '显示',
    hide: '隐藏',
    verify: '验证令牌',
    verifying: '正在验证…',
    missing: '请先粘贴访问令牌。',
    security:
      '令牌保存在本机 localStorage，关闭应用后仍保留；不要把它写进代码或分享给他人。',
  },
  repos: {
    connected: '已连接',
    privateOnly: '仅显示私有仓库',
    pickTitle: '选择一个私有仓库',
    loading: '正在读取你的私有仓库…',
    empty: '还没有私有仓库，可以在下面新建一个。',
    retry: '重新加载',
    privateLabel: '私有仓库',
    updated: (date: string) => (date ? `更新于 ${date}` : '最近更新'),
    createTitle: '新建私有仓库',
    createLabel: '仓库名称',
    createPlaceholder: 'lanshan-schedule',
    createHint: '会自动初始化 README，并生成 main 分支。',
    createAction: '新建私有仓库',
    creating: '正在创建…',
    nameRequired: '请填写仓库名称。',
    created: (repo: string) => `已创建 ${repo} 并为你选中。`,
    branchLabel: '同步分支',
    branchHint: '一般留 main 即可；旧仓库可能是 master。',
    needRepo: '请选择一个仓库，或先新建一个。',
    connect: '连接并同步',
  },
  errors: {
    unknown: '出现未知错误，请重试。',
  },
} as const

const PAT_CREATE_URL = 'https://github.com/settings/personal-access-tokens/new'

interface GitHubConnectDialogProps {
  clientId: string
  initialToken?: string
  onClose: () => void
  onConnected: (payload: {
    token: string
    login: string
    avatarUrl: string
    owner: string
    repo: string
    branch: string
  }) => void
}

type Stage = 'entry' | 'device' | 'pat' | 'repos'
type CopyState = 'idle' | 'done' | 'failed'

const STEPS = [COPY.stepLogin, COPY.stepRepo, COPY.stepDone]

function toMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return COPY.errors.unknown
}

/** GitHub user codes are 8–9 characters; show them as 4-4 groups. */
function groupCode(code: string): string[] {
  const compact = code.replace(/[^A-Za-z0-9]/g, '')
  return compact.match(/.{1,4}/g) ?? [code]
}

function formatRepoDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

export function GitHubConnectDialog({
  clientId,
  initialToken,
  onClose,
  onConnected,
}: GitHubConnectDialogProps) {
  const [stage, setStage] = useState<Stage>('entry')
  const [token, setToken] = useState('')
  const [user, setUser] = useState<GitHubUser | null>(null)

  const [device, setDevice] = useState<GitHubDeviceStart | null>(null)
  const [deviceBusy, setDeviceBusy] = useState(false)
  const [deviceError, setDeviceError] = useState('')
  const [copyState, setCopyState] = useState<CopyState>('idle')

  const [patToken, setPatToken] = useState(initialToken ?? '')
  const [showToken, setShowToken] = useState(false)
  const [patError, setPatError] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [booting, setBooting] = useState(Boolean(initialToken?.trim()))

  const [repos, setRepos] = useState<GitHubRepoSummary[]>([])
  const [reposLoading, setReposLoading] = useState(false)
  const [reposError, setReposError] = useState('')
  const [selectedRepo, setSelectedRepo] = useState('')
  const [branch, setBranch] = useState('main')

  const [newRepo, setNewRepo] = useState('lanshan-schedule')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [createNotice, setCreateNotice] = useState('')

  const dialogRef = useRef<HTMLDivElement>(null)
  const loadSeq = useRef(0)
  const hasClientId = clientId.trim().length > 0
  const stepIndex: number = stage === 'repos' ? 1 : 0
  const expiryMinutes = device ? Math.max(1, Math.round(device.expiresIn / 60)) : 15

  const loadRepos = useCallback(async (accessToken: string) => {
    const seq = loadSeq.current + 1
    loadSeq.current = seq
    setReposLoading(true)
    setReposError('')
    try {
      const list = await listPrivateRepos(accessToken)
      // A newer load (or an account switch) wins over this stale response.
      if (loadSeq.current !== seq) return
      setRepos(list)
      setSelectedRepo((current) =>
        list.some((repo) => repo.name === current) ? current : '',
      )
    } catch (error) {
      if (loadSeq.current !== seq) return
      setReposError(toMessage(error))
    } finally {
      if (loadSeq.current === seq) setReposLoading(false)
    }
  }, [])

  const beginSession = useCallback(
    async (accessToken: string, signal?: AbortSignal) => {
      const profile = await getGitHubUser(accessToken)
      if (signal?.aborted) return
      setToken(accessToken)
      setUser(profile)
      setStage('repos')
      void loadRepos(accessToken)
    },
    [loadRepos],
  )

  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  useEffect(() => {
    if (!initialToken?.trim()) return
    // `patToken` / `booting` start from `initialToken`; this effect only talks
    // to GitHub, never sets state synchronously.
    const guard = new AbortController()
    // Verifying a token passed in by the parent is exactly the "external
    // system" case this effect exists for; state only changes after await.
    // oxlint-disable-next-line react/set-state-in-effect
    beginSession(initialToken, guard.signal)
      .catch((error: unknown) => {
        if (guard.signal.aborted) return
        setPatError(toMessage(error))
        setStage('pat')
      })
      .finally(() => {
        if (guard.signal.aborted) return
        setBooting(false)
        setVerifying(false)
      })
    return () => guard.abort()
  }, [beginSession, initialToken])

  useEffect(() => {
    if (stage !== 'device' || !device) return
    const controller = new AbortController()
    pollDeviceFlow(clientId, device.deviceCode, device.interval, controller.signal)
      .then((accessToken) => {
        if (controller.signal.aborted) return undefined
        return beginSession(accessToken, controller.signal)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setDeviceError(toMessage(error))
      })
    return () => controller.abort()
  }, [beginSession, clientId, device, stage])

  useEffect(() => {
    if (copyState === 'idle') return
    const timer = window.setTimeout(() => setCopyState('idle'), 2400)
    return () => window.clearTimeout(timer)
  }, [copyState])

  const startDevice = useCallback(async () => {
    setDeviceBusy(true)
    setDeviceError('')
    try {
      const session = await startDeviceFlow(clientId)
      setDevice(session)
      setCopyState('idle')
      setStage('device')
    } catch (error) {
      setDeviceError(toMessage(error))
    } finally {
      setDeviceBusy(false)
    }
  }, [clientId])

  const cancelDevice = () => {
    setStage('entry')
    setDevice(null)
    setDeviceError('')
    setCopyState('idle')
  }

  const openVerification = () => {
    if (!device) return
    void openExternal(device.verificationUri)
  }

  const copyCode = async () => {
    if (!device) return
    try {
      await copyText(device.userCode)
      setCopyState('done')
    } catch {
      setCopyState('failed')
    }
  }

  const verifyPat = useCallback(async () => {
    const candidate = patToken.trim()
    if (!candidate) {
      setPatError(COPY.pat.missing)
      return
    }
    setVerifying(true)
    setPatError('')
    try {
      await beginSession(candidate)
    } catch (error) {
      setPatError(toMessage(error))
      setStage('pat')
    } finally {
      setVerifying(false)
    }
  }, [beginSession, patToken])

  const selectRepo = (repo: GitHubRepoSummary) => {
    setSelectedRepo(repo.name)
    setBranch(repo.defaultBranch || 'main')
    setCreateNotice('')
  }

  const createRepo = useCallback(async () => {
    const name = newRepo.trim()
    if (!name) {
      setCreateError(COPY.repos.nameRequired)
      return
    }
    setCreating(true)
    setCreateError('')
    setCreateNotice('')
    try {
      const created = await createPrivateRepo(token, name)
      const summary: GitHubRepoSummary = {
        name: created.repo,
        fullName: created.owner ? `${created.owner}/${created.repo}` : created.repo,
        defaultBranch: created.defaultBranch,
        private: true,
        updatedAt: new Date().toISOString(),
      }
      setRepos((current) =>
        current.some((repo) => repo.name === summary.name) ? current : [summary, ...current],
      )
      setSelectedRepo(summary.name)
      setBranch(summary.defaultBranch || 'main')
      setCreateNotice(COPY.repos.created(summary.name))
    } catch (error) {
      setCreateError(toMessage(error))
    } finally {
      setCreating(false)
    }
  }, [newRepo, token])

  const switchAccount = () => {
    loadSeq.current += 1
    setStage('entry')
    setUser(null)
    setToken('')
    setRepos([])
    setReposLoading(false)
    setSelectedRepo('')
    setReposError('')
    setCreateError('')
    setCreateNotice('')
    setPatToken('')
    setPatError('')
    setDevice(null)
    setDeviceError('')
  }

  const connect = () => {
    if (!user || !selectedRepo) return
    onConnected({
      token,
      login: user.login,
      avatarUrl: user.avatarUrl,
      owner: user.login,
      repo: selectedRepo,
      branch: branch.trim() || 'main',
    })
  }

  const busy = booting || verifying || deviceBusy || reposLoading || creating

  return (
    <div className="modal-backdrop gh-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="gh-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={COPY.title}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="gh-dialog__head">
          <span className="gh-mark">
            <Icon name="github" size={24} />
          </span>
          <div className="gh-dialog__titles">
            <p className="gh-eyebrow">{COPY.eyebrow}</p>
            <h2 className="gh-dialog__title">{COPY.title}</h2>
          </div>
          <button className="gh-close" type="button" onClick={onClose} aria-label={COPY.close}>
            <Icon name="x" size={18} />
          </button>
        </header>

        <ol className="gh-steps" aria-label={COPY.stepLabel}>
          {STEPS.map((label, index) => {
            const done = index < stepIndex
            const active = index === stepIndex
            return (
              <li
                key={label}
                className={`gh-step${done ? ' is-done' : ''}${active ? ' is-active' : ''}`}
                aria-current={active ? 'step' : undefined}
              >
                <span className="gh-step__num" aria-hidden="true">
                  {done ? <Icon name="check" size={11} /> : String(index + 1).padStart(2, '0')}
                </span>
                <span className="gh-step__label">{label}</span>
              </li>
            )
          })}
        </ol>

        <div className="gh-body" aria-busy={busy}>
          {stage === 'entry' && !booting && (
            <div className="gh-view">
              <p className="gh-lede">{COPY.lede}</p>
              <div className="gh-choices">
                <button
                  className="gh-choice gh-choice--primary"
                  type="button"
                  onClick={startDevice}
                  disabled={!hasClientId || deviceBusy}
                >
                  <span className="gh-choice__icon">
                    <Icon name="github" size={22} />
                  </span>
                  <span className="gh-choice__text">
                    <strong>
                      {deviceBusy ? COPY.entry.oauthStarting : COPY.entry.oauthTitle}
                    </strong>
                    <small>{COPY.entry.oauthBody}</small>
                  </span>
                  {deviceBusy ? (
                    <span className="gh-spinner" aria-hidden="true" />
                  ) : (
                    <Icon name="arrow-right" size={16} />
                  )}
                </button>
                {!hasClientId && (
                  <>
                    <p className="gh-hint gh-hint--dev">{COPY.entry.clientIdMissing}</p>
                    <button
                      className="gh-link"
                      type="button"
                      onClick={() => {
                        void openExternal('https://github.com/settings/applications/new')
                      }}
                    >
                      打开 GitHub 创建 OAuth App
                    </button>
                  </>
                )}
                <button className="gh-choice" type="button" onClick={() => setStage('pat')}>
                  <span className="gh-choice__icon">
                    <Icon name="lock" size={20} />
                  </span>
                  <span className="gh-choice__text">
                    <strong>{COPY.entry.patTitle}</strong>
                    <small>{COPY.entry.patBody}</small>
                  </span>
                  <Icon name="arrow-right" size={16} />
                </button>
              </div>
              {deviceError && (
                <p className="gh-error" role="alert">
                  <Icon name="alert" size={14} />
                  <span>{deviceError}</span>
                </p>
              )}
              <p className="gh-note">
                <Icon name="lock" size={13} />
                {COPY.entry.security}
              </p>
            </div>
          )}

          {stage === 'entry' && booting && (
            <div className="gh-view">
              <p className="gh-loading" role="status">
                <span className="gh-spinner" aria-hidden="true" />
                {COPY.booting}
              </p>
            </div>
          )}

          {stage === 'device' && device && (
            <div className="gh-view">
              <div className="gh-view__bar">
                <button className="gh-back" type="button" onClick={cancelDevice}>
                  <Icon name="chevron-left" size={15} />
                  {COPY.back}
                </button>
              </div>
              <p className="gh-lede">{COPY.device.lede}</p>
              <div className="gh-code">
                <span className="gh-code__label">{COPY.device.codeLabel}</span>
                <div className="gh-code__value" aria-live="polite">
                  {groupCode(device.userCode).map((group, index) => (
                    <span className="gh-code__group" key={`${group}-${index}`}>
                      {group}
                    </span>
                  ))}
                </div>
                <button className="gh-copy" type="button" onClick={() => void copyCode()}>
                  <Icon name={copyState === 'done' ? 'check' : 'copy'} size={15} />
                  {copyState === 'done' ? COPY.device.copied : COPY.device.copy}
                </button>
              </div>
              <p className="gh-code__hint">{COPY.device.expiry(expiryMinutes)}</p>
              {copyState === 'failed' && <p className="gh-hint">{COPY.device.copyFailed}</p>}
              <button className="gh-primary" type="button" onClick={openVerification}>
                <Icon name="external" size={16} />
                {COPY.device.open}
              </button>
              {deviceError ? (
                <div className="gh-error" role="alert">
                  <Icon name="alert" size={14} />
                  <span>{deviceError}</span>
                  <button
                    className="gh-ghost gh-ghost--tiny"
                    type="button"
                    onClick={() => void startDevice()}
                    disabled={deviceBusy}
                  >
                    {COPY.device.retry}
                  </button>
                </div>
              ) : (
                <p className="gh-status" role="status">
                  <span className="gh-spinner" aria-hidden="true" />
                  {COPY.device.waiting}
                </p>
              )}
              <button className="gh-ghost" type="button" onClick={cancelDevice}>
                {COPY.device.cancel}
              </button>
            </div>
          )}

          {stage === 'pat' && (
            <div className="gh-view">
              <div className="gh-view__bar">
                <button className="gh-back" type="button" onClick={() => setStage('entry')}>
                  <Icon name="chevron-left" size={15} />
                  {COPY.back}
                </button>
              </div>
              <p className="gh-lede">{COPY.pat.lede}</p>
              <ol className="gh-guide">
                <li className="gh-guide__item">
                  <span className="gh-guide__num" aria-hidden="true">
                    1
                  </span>
                  <div className="gh-guide__text">
                    <strong>{COPY.pat.step1Title}</strong>
                    <p>{COPY.pat.step1Body}</p>
                    <a className="gh-link" href={PAT_CREATE_URL} target="_blank" rel="noreferrer">
                      {COPY.pat.step1Link}
                      <Icon name="external" size={13} />
                    </a>
                  </div>
                </li>
                <li className="gh-guide__item">
                  <span className="gh-guide__num" aria-hidden="true">
                    2
                  </span>
                  <div className="gh-guide__text">
                    <strong>{COPY.pat.step2Title}</strong>
                    <p>{COPY.pat.step2Body}</p>
                  </div>
                </li>
                <li className="gh-guide__item">
                  <span className="gh-guide__num" aria-hidden="true">
                    3
                  </span>
                  <div className="gh-guide__text">
                    <strong>{COPY.pat.step3Title}</strong>
                    <p>{COPY.pat.step3Body}</p>
                  </div>
                </li>
              </ol>
              <form
                className="gh-token"
                onSubmit={(event) => {
                  event.preventDefault()
                  void verifyPat()
                }}
              >
                <div className="gh-field">
                  <label htmlFor="gh-pat-token" className="gh-field__label">
                    {COPY.pat.fieldLabel}
                  </label>
                  <span className="gh-field__row">
                    <input
                      id="gh-pat-token"
                      type={showToken ? 'text' : 'password'}
                      value={patToken}
                      onChange={(event) => setPatToken(event.target.value)}
                      placeholder={COPY.pat.placeholder}
                      spellCheck={false}
                      autoComplete="off"
                      autoCapitalize="none"
                    />
                    <button
                      className="gh-ghost gh-ghost--tiny"
                      type="button"
                      onClick={() => setShowToken((value) => !value)}
                    >
                      {showToken ? COPY.pat.hide : COPY.pat.show}
                    </button>
                  </span>
                </div>
                <button
                  className="gh-primary"
                  type="submit"
                  disabled={!patToken.trim() || verifying}
                >
                  {verifying ? (
                    <span className="gh-spinner" aria-hidden="true" />
                  ) : (
                    <Icon name="lock" size={15} />
                  )}
                  {verifying ? COPY.pat.verifying : COPY.pat.verify}
                </button>
              </form>
              {patError && (
                <p className="gh-error" role="alert">
                  <Icon name="alert" size={14} />
                  <span>{patError}</span>
                </p>
              )}
              <p className="gh-note">
                <Icon name="lock" size={13} />
                {COPY.pat.security}
              </p>
            </div>
          )}

          {stage === 'repos' && user && (
            <div className="gh-view">
              <div className="gh-view__bar">
                <button className="gh-back" type="button" onClick={switchAccount}>
                  <Icon name="chevron-left" size={15} />
                  {COPY.switchAccount}
                </button>
              </div>

              <div className="gh-account">
                {user.avatarUrl ? (
                  <img
                    className="gh-avatar"
                    src={user.avatarUrl}
                    alt=""
                    width={42}
                    height={42}
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="gh-avatar gh-avatar--fallback" aria-hidden="true">
                    {user.login.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <div className="gh-account__text">
                  <strong>@{user.login}</strong>
                  <small>
                    {user.name && user.name !== user.login ? user.name : COPY.repos.privateOnly}
                  </small>
                </div>
                <span className="gh-account__badge">
                  <Icon name="check" size={12} />
                  {COPY.repos.connected}
                </span>
              </div>

              <section className="gh-section">
                <h3 className="gh-section__title">{COPY.repos.pickTitle}</h3>
                {reposLoading && (
                  <p className="gh-loading" role="status">
                    <span className="gh-spinner" aria-hidden="true" />
                    {COPY.repos.loading}
                  </p>
                )}
                {reposError && (
                  <div className="gh-error" role="alert">
                    <Icon name="alert" size={14} />
                    <span>{reposError}</span>
                    <button
                      className="gh-ghost gh-ghost--tiny"
                      type="button"
                      onClick={() => void loadRepos(token)}
                    >
                      {COPY.repos.retry}
                    </button>
                  </div>
                )}
                {!reposLoading && !reposError && repos.length === 0 && (
                  <p className="gh-empty">{COPY.repos.empty}</p>
                )}
                <div className="gh-repos" role="group" aria-label={COPY.repos.pickTitle}>
                  {repos.map((repo) => {
                    const selected = repo.name === selectedRepo
                    return (
                      <button
                        key={repo.fullName}
                        className={`gh-repo${selected ? ' is-selected' : ''}`}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => selectRepo(repo)}
                      >
                        <span className="gh-repo__lock" role="img" aria-label={COPY.repos.privateLabel}>
                          <Icon name="lock" size={13} />
                        </span>
                        <span className="gh-repo__text">
                          <strong>{repo.name}</strong>
                          <small>{COPY.repos.updated(formatRepoDate(repo.updatedAt))}</small>
                        </span>
                        <span className="gh-repo__check" aria-hidden="true">
                          <Icon name="check" size={14} />
                        </span>
                      </button>
                    )
                  })}
                </div>
              </section>

              <section className="gh-section">
                <h3 className="gh-section__title">{COPY.repos.createTitle}</h3>
                <div className="gh-create">
                  <label className="gh-field gh-field--inline">
                    <span className="gh-field__label">{COPY.repos.createLabel}</span>
                    <input
                      value={newRepo}
                      onChange={(event) => setNewRepo(event.target.value)}
                      placeholder={COPY.repos.createPlaceholder}
                      spellCheck={false}
                      autoCapitalize="none"
                    />
                  </label>
                  <button
                    className="gh-ghost"
                    type="button"
                    onClick={() => void createRepo()}
                    disabled={creating || reposLoading || !newRepo.trim()}
                  >
                    {creating ? (
                      <span className="gh-spinner" aria-hidden="true" />
                    ) : (
                      <Icon name="plus" size={15} />
                    )}
                    {creating ? COPY.repos.creating : COPY.repos.createAction}
                  </button>
                </div>
                <p className="gh-hint">{COPY.repos.createHint}</p>
                {createError && (
                  <p className="gh-error" role="alert">
                    <Icon name="alert" size={14} />
                    <span>{createError}</span>
                  </p>
                )}
                {createNotice && (
                  <p className="gh-success" role="status">
                    <Icon name="check" size={14} />
                    {createNotice}
                  </p>
                )}
              </section>

              <section className="gh-section">
                <label className="gh-field gh-field--inline">
                  <span className="gh-field__label">{COPY.repos.branchLabel}</span>
                  <input
                    value={branch}
                    onChange={(event) => setBranch(event.target.value)}
                    placeholder="main"
                    spellCheck={false}
                    autoCapitalize="none"
                  />
                </label>
                <p className="gh-hint">{COPY.repos.branchHint}</p>
              </section>

              {!selectedRepo && <p className="gh-hint">{COPY.repos.needRepo}</p>}
            </div>
          )}
        </div>

        <footer className="gh-dialog__foot">
          <span className="gh-foot__hint">
            <Icon name="keyboard" size={13} />
            {COPY.escHint}
          </span>
          <div className="gh-foot__actions">
            {stage !== 'device' && (
              <button className="gh-ghost" type="button" onClick={onClose}>
                {COPY.cancel}
              </button>
            )}
            {stage === 'repos' && (
              <button
                className="gh-primary gh-primary--compact"
                type="button"
                onClick={connect}
                disabled={!selectedRepo || creating}
              >
                <Icon name="cloud" size={15} />
                {COPY.repos.connect}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  )
}

