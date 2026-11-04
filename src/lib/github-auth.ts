/**
 * GitHub connection helpers for the onboarding dialog.
 *
 * This module only speaks HTTP: OAuth Device Flow, a small slice of the REST
 * API, and the friendly Chinese errors the UI shows. It never touches storage
 * and never logs a token. Callers decide where the token is kept.
 */

import { nativeGitHubRequest } from './native'

export interface GitHubDeviceStart {
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresIn: number
  interval: number
}

export interface GitHubUser {
  login: string
  name: string
  avatarUrl: string
}

export interface GitHubRepoSummary {
  name: string
  fullName: string
  defaultBranch: string
  private: boolean
  updatedAt: string
}

export interface GitHubCreatedRepo {
  owner: string
  repo: string
  defaultBranch: string
}

interface DeviceCodePayload {
  device_code?: string
  user_code?: string
  verification_uri?: string
  verification_uri_complete?: string
  expires_in?: number
  interval?: number
}

interface DeviceTokenPayload {
  access_token?: string
  token_type?: string
  scope?: string
  error?: string
  error_description?: string
  interval?: number
}

interface UserPayload {
  login?: string
  name?: string | null
  avatar_url?: string
}

interface RepoPayload {
  name?: string
  full_name?: string
  default_branch?: string
  private?: boolean
  updated_at?: string
  owner?: { login?: string }
}

interface ErrorPayload {
  message?: string
  error?: string
  error_description?: string
  errors?: Array<{ message?: string; code?: string; field?: string }>
}

const API_ROOT = 'https://api.github.com'
const WEB_ROOT = 'https://github.com'
const DEVICE_CODE_ENDPOINT = `${WEB_ROOT}/login/device/code`
const ACCESS_TOKEN_ENDPOINT = `${WEB_ROOT}/login/oauth/access_token`
const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code'
const API_VERSION = '2022-11-28'
const REQUEST_TIMEOUT_MS = 20_000
const FALLBACK_INTERVAL_SECONDS = 5
const FALLBACK_EXPIRES_SECONDS = 900
const NETWORK_ERROR = '无法连接 GitHub，请检查网络或代理后重试。'

class GitHubHttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'GitHubHttpError'
    this.status = status
  }
}

function abortError(): Error {
  const error = new Error('已取消 GitHub 操作。')
  error.name = 'AbortError'
  return error
}

function friendlyStatusMessage(status: number, detail: string, action: string): string {
  switch (status) {
    case 400:
      return `${action}失败：GitHub 无法理解这次请求${detail ? `（${detail}）` : ''}。`
    case 401:
      return `${action}失败：令牌无效或已过期，请重新授权。`
    case 403:
      return `${action}失败：GitHub 拒绝访问，可能是权限不足或触发了限流。`
    case 404:
      return `${action}失败：GitHub 上找不到对应的仓库或资源，请确认令牌权限。`
    case 422:
      return `${action}失败：${detail || '请求内容不被接受。'}`
    case 429:
      return `${action}失败：请求过于频繁，请稍后再试。`
    default: {
      if (status >= 500) return `${action}失败：GitHub 服务暂时不可用（${status}），请稍后重试。`
      return `${action}失败：${detail || `HTTP ${status}`}`
    }
  }
}

function failureDetailFromText(text: string): string {
  try {
    const payload = JSON.parse(text) as ErrorPayload
    const parts: string[] = []
    if (typeof payload.message === 'string') parts.push(payload.message)
    if (typeof payload.error_description === 'string') parts.push(payload.error_description)
    if (typeof payload.error === 'string') parts.push(payload.error)
    if (Array.isArray(payload.errors)) {
      for (const issue of payload.errors) {
        if (issue && typeof issue.message === 'string') parts.push(issue.message)
      }
    }
    return parts.join('；')
  } catch {
    // Some GitHub responses (proxies, rate limits) are HTML, not JSON.
    return ''
  }
}

async function readFailure(response: Response): Promise<string> {
  return failureDetailFromText(await response.text())
}

interface RequestOptions {
  method?: 'GET' | 'POST'
  token?: string
  json?: unknown
  form?: Record<string, string>
  signal?: AbortSignal
  timeoutMs?: number
  /** Chinese verb used to build the error sentence, e.g. "读取私有仓库". */
  action: string
}

/**
 * One place for GitHub headers, timeouts and error translation. Every public
 * helper funnels through here so the UI only ever sees Chinese messages.
 */
async function requestGitHub<T>(url: string, options: RequestOptions): Promise<T> {
  const controller = new AbortController()
  let timedOut = false
  let aborted = false
  const timer = window.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, options.timeoutMs ?? REQUEST_TIMEOUT_MS)

  const forwardAbort = () => {
    aborted = true
    controller.abort()
  }
  if (options.signal) {
    if (options.signal.aborted) {
      window.clearTimeout(timer)
      throw abortError()
    }
    options.signal.addEventListener('abort', forwardAbort, { once: true })
  }

  const isApi = url.startsWith(API_ROOT)
  const headers: Record<string, string> = {
    Accept: isApi ? 'application/vnd.github+json' : 'application/json',
  }
  if (isApi) headers['X-GitHub-Api-Version'] = API_VERSION
  if (options.token) headers.Authorization = `Bearer ${options.token}`

  let body: string | undefined
  if (options.form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
    body = new URLSearchParams(options.form).toString()
  } else if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(options.json)
  }

  try {
    const method = options.method ?? 'GET'
    const native = await nativeGitHubRequest(
      method,
      url,
      body ?? '',
      headers['Content-Type'] ?? 'application/json',
      options.token ?? '',
    )
    if (native) {
      if (native.status < 200 || native.status >= 300) {
        throw new GitHubHttpError(
          native.status,
          friendlyStatusMessage(native.status, failureDetailFromText(native.body), options.action),
        )
      }
      try {
        return JSON.parse(native.body) as T
      } catch {
        throw new Error(`${options.action}失败：GitHub 返回了无法解析的数据。`)
      }
    }

    const response = await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal,
    })
    if (!response.ok) {
      const detail = await readFailure(response)
      throw new GitHubHttpError(
        response.status,
        friendlyStatusMessage(response.status, detail, options.action),
      )
    }
    return (await response.json()) as T
  } catch (error) {
    if (error instanceof GitHubHttpError) throw error
    if (aborted) throw abortError()
    if (timedOut) throw new Error(`${options.action}超时，请检查网络后重试。`)
    if (error instanceof SyntaxError) throw new Error(`${options.action}失败：GitHub 返回了无法解析的数据。`)
    if (error instanceof TypeError && url.startsWith(WEB_ROOT)) {
      throw new Error(
        '浏览器阻止了 GitHub 设备授权请求（CORS）。请使用 Windows/Android 客户端，或改用访问令牌。',
      )
    }
    throw new Error(NETWORK_ERROR)
  } finally {
    window.clearTimeout(timer)
    options.signal?.removeEventListener('abort', forwardAbort)
  }
}

function requireToken(token: string, action: string): string {
  const trimmed = token.trim()
  if (!trimmed) throw new Error(`${action}失败：请先填写 GitHub 访问令牌。`)
  return trimmed
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }
    const onAbort = () => {
      window.clearTimeout(timer)
      reject(abortError())
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Step 1 of the Device Flow: ask GitHub for a user code to type in a browser. */
export async function startDeviceFlow(
  clientId: string,
  scope = 'repo read:user',
): Promise<GitHubDeviceStart> {
  const trimmed = clientId.trim()
  if (!trimmed) {
    throw new Error('尚未配置 GitHub OAuth Client ID，请先在环境变量 VITE_GITHUB_CLIENT_ID 中填写。')
  }

  const payload = await requestGitHub<DeviceCodePayload>(DEVICE_CODE_ENDPOINT, {
    method: 'POST',
    form: { client_id: trimmed, scope },
    action: '申请 GitHub 设备码',
  })

  if (!payload.device_code || !payload.user_code) {
    throw new Error('GitHub 没有返回设备码，请稍后重试。')
  }

  return {
    deviceCode: payload.device_code,
    userCode: payload.user_code,
    verificationUri: payload.verification_uri || `${WEB_ROOT}/login/device`,
    expiresIn: Number(payload.expires_in) || FALLBACK_EXPIRES_SECONDS,
    interval: Number(payload.interval) || FALLBACK_INTERVAL_SECONDS,
  }
}

/**
 * Step 2 of the Device Flow: poll until the browser side authorizes. The loop
 * waits before the first attempt, backs off by 5s on `slow_down`, and resolves
 * with the access token. Aborting `signal` rejects with an AbortError.
 */
export async function pollDeviceFlow(
  clientId: string,
  deviceCode: string,
  intervalSeconds: number,
  signal?: AbortSignal,
): Promise<string> {
  const trimmed = clientId.trim()
  if (!trimmed) {
    throw new Error('尚未配置 GitHub OAuth Client ID，请先在环境变量 VITE_GITHUB_CLIENT_ID 中填写。')
  }
  if (!deviceCode) throw new Error('设备码为空，请重新开始 GitHub 登录。')

  let interval = Math.max(1, Math.round(intervalSeconds) || FALLBACK_INTERVAL_SECONDS)

  for (;;) {
    await wait(interval * 1_000, signal)

    const payload = await requestGitHub<DeviceTokenPayload>(ACCESS_TOKEN_ENDPOINT, {
      method: 'POST',
      form: {
        client_id: trimmed,
        device_code: deviceCode,
        grant_type: DEVICE_GRANT_TYPE,
      },
      signal,
      action: '获取 GitHub 授权',
    })

    if (payload.access_token) return payload.access_token

    switch (payload.error) {
      case 'authorization_pending':
        continue
      case 'slow_down':
        interval += 5
        continue
      case 'expired_token':
        throw new Error('设备码已过期，请重新开始登录。')
      case 'access_denied':
        throw new Error('你取消了 GitHub 授权，可以重新尝试。')
      case 'incorrect_client_credentials':
        throw new Error('Client ID 无效，请检查 VITE_GITHUB_CLIENT_ID 配置。')
      case 'unsupported_grant_type':
        throw new Error('GitHub 不接受设备码登录，请改用访问令牌连接。')
      case undefined:
        throw new Error('GitHub 没有返回访问令牌，请重试。')
      default:
        throw new Error(
          `GitHub 授权失败：${payload.error_description ?? payload.error ?? '未知原因'}`,
        )
    }
  }
}

/** The signed-in account behind a token. */
export async function getGitHubUser(token: string): Promise<GitHubUser> {
  const accessToken = requireToken(token, '验证 GitHub 身份')
  const payload = await requestGitHub<UserPayload>(`${API_ROOT}/user`, {
    token: accessToken,
    action: '验证 GitHub 身份',
  })
  if (!payload.login) throw new Error('GitHub 没有返回账户信息，请重试。')
  return {
    login: payload.login,
    name: typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : payload.login,
    avatarUrl: payload.avatar_url ?? '',
  }
}

/** Up to 100 private repos the user owns, newest activity first. */
export async function listPrivateRepos(token: string): Promise<GitHubRepoSummary[]> {
  const accessToken = requireToken(token, '读取私有仓库')
  const payload = await requestGitHub<RepoPayload[]>(
    `${API_ROOT}/user/repos?visibility=private&affiliation=owner&sort=updated&per_page=100`,
    { token: accessToken, action: '读取私有仓库' },
  )
  if (!Array.isArray(payload)) throw new Error('GitHub 返回的仓库列表格式不正确。')

  const repos: GitHubRepoSummary[] = []
  for (const repo of payload) {
    if (typeof repo.name !== 'string' || repo.name.length === 0) continue
    repos.push({
      name: repo.name,
      fullName: repo.full_name ?? repo.name,
      defaultBranch: repo.default_branch ?? 'main',
      private: repo.private !== false,
      updatedAt: repo.updated_at ?? new Date().toISOString(),
    })
  }
  return repos
}

function alreadyExists(error: unknown): boolean {
  return (
    error instanceof GitHubHttpError &&
    error.status === 422 &&
    /already exists|already_exists|already been taken|已存在/i.test(error.message)
  )
}

async function readRepo(token: string, owner: string, repo: string): Promise<GitHubCreatedRepo> {
  const payload = await requestGitHub<RepoPayload>(
    `${API_ROOT}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    { token, action: `读取仓库 ${repo}` },
  )
  return {
    owner: payload.owner?.login ?? owner,
    repo: payload.name ?? repo,
    defaultBranch: payload.default_branch ?? 'main',
  }
}

/**
 * Create a private, auto-initialized repo. A 422 "already exists" is not an
 * error for onboarding: the existing repo is returned instead.
 */
export async function createPrivateRepo(token: string, name: string): Promise<GitHubCreatedRepo> {
  const accessToken = requireToken(token, '创建私有仓库')
  const repoName = name.trim()
  if (!repoName) throw new Error('仓库名称不能为空。')

  try {
    const payload = await requestGitHub<RepoPayload>(`${API_ROOT}/user/repos`, {
      method: 'POST',
      token: accessToken,
      json: {
        name: repoName,
        private: true,
        auto_init: true,
        description: '阑珊时刻日程同步仓库',
      },
      action: `创建仓库 ${repoName}`,
    })
    return {
      owner: payload.owner?.login ?? '',
      repo: payload.name ?? repoName,
      defaultBranch: payload.default_branch ?? 'main',
    }
  } catch (error) {
    if (!alreadyExists(error)) throw error
    const owner = (await getGitHubUser(accessToken)).login
    return readRepo(accessToken, owner, repoName)
  }
}
