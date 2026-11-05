import type { ScheduleDocument, ScheduleEvent } from '../types'

export interface GitHubConfig {
  owner: string
  repo: string
  branch: string
  token: string
}

export interface GitHubIdentity {
  login: string
  avatarUrl: string
}

const API = 'https://api.github.com'
const FILE_PATH = 'schedule.json'

function headers(token: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

async function readError(response: Response): Promise<string> {
  let detail = `${response.status} ${response.statusText}`
  try {
    const payload = (await response.json()) as { message?: string }
    if (payload.message) detail = payload.message
  } catch {
    // Keep the HTTP status when the body is not JSON.
  }
  return detail
}

function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index])
  }
  return btoa(binary)
}

function decodeBase64(content: string): string {
  const binary = atob(content.replace(/\s/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new TextDecoder().decode(bytes)
}

function pathFor(config: GitHubConfig): string {
  return `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(
    config.repo,
  )}/contents/${FILE_PATH}`
}

async function readFileAt(
  config: GitHubConfig,
  branch?: string,
): Promise<{ document: ScheduleDocument; sha: string } | null> {
  const query = branch ? `?ref=${encodeURIComponent(branch)}` : ''
  const response = await fetch(`${API}${pathFor(config)}${query}`, {
    headers: headers(config.token),
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`读取云端日程失败：${await readError(response)}`)

  const payload = (await response.json()) as { content?: string; sha?: string }
  if (!payload.content || !payload.sha) throw new Error('云端 schedule.json 格式不正确')
  const document = JSON.parse(decodeBase64(payload.content)) as ScheduleDocument
  if (!Array.isArray(document.events)) throw new Error('云端 schedule.json 缺少 events')
  return { document, sha: payload.sha }
}

export async function verifyGitHub(config: GitHubConfig): Promise<GitHubIdentity> {
  const userResponse = await fetch(`${API}/user`, { headers: headers(config.token) })
  if (!userResponse.ok) throw new Error(`GitHub 身份验证失败：${await readError(userResponse)}`)
  const user = (await userResponse.json()) as { login: string; avatar_url: string }

  const repoResponse = await fetch(
    `${API}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`,
    { headers: headers(config.token) },
  )
  if (!repoResponse.ok) throw new Error(`无法访问仓库：${await readError(repoResponse)}`)
  return { login: user.login, avatarUrl: user.avatar_url }
}

interface RemoteFile {
  document: ScheduleDocument
  sha: string
  /** Empty string means GitHub's default branch. */
  branch: string
}

export async function pullSchedule(config: GitHubConfig): Promise<RemoteFile | null> {
  const explicit = await readFileAt(config, config.branch)
  if (explicit) return { ...explicit, branch: config.branch }

  // A repository can have schedule.json on its default branch while the user
  // typed another branch (or an old branch name). Fall back once so sync does
  // not treat an existing file as new and then fail with "sha wasn't supplied".
  if (config.branch) {
    const fallback = await readFileAt(config)
    if (fallback) return { ...fallback, branch: '' }
  }
  return null
}

function chooseEvent(local: ScheduleEvent, remote: ScheduleEvent): ScheduleEvent {
  const localTime = Date.parse(local.updatedAt)
  const remoteTime = Date.parse(remote.updatedAt)
  if (localTime > remoteTime) return local
  if (remoteTime > localTime) return remote
  // Same millisecond: a tombstone is deliberate, so it wins the tie.
  if (local.deletedAt && !remote.deletedAt) return local
  if (remote.deletedAt && !local.deletedAt) return remote
  // Same millisecond is rare; the device id makes the winner deterministic.
  return local.deviceId >= remote.deviceId ? local : remote
}

/**
 * Record-level last-write-wins merge. DarkCube treats the remote copy as
 * authoritative and saves a .conflict file. A timetable can be edited on two
 * devices at once, so we keep both sides and merge per event. The merged
 * document still contains tombstones, which makes deletions sync correctly.
 */
export function mergeSchedules(
  local: ScheduleDocument,
  remote: ScheduleDocument,
): { document: ScheduleDocument; changed: number } {
  const byId = new Map<string, ScheduleEvent>()
  let changed = 0

  for (const event of remote.events) byId.set(event.id, event)
  for (const event of local.events) {
    const other = byId.get(event.id)
    if (!other) {
      byId.set(event.id, event)
      changed += 1
      continue
    }
    const winner = chooseEvent(event, other)
    if (JSON.stringify(winner) !== JSON.stringify(other)) changed += 1
    byId.set(event.id, winner)
  }

  const events = Array.from(byId.values()).sort((a, b) => {
    const aTime = a.start ? Date.parse(a.start) : Number.MAX_SAFE_INTEGER
    const bTime = b.start ? Date.parse(b.start) : Number.MAX_SAFE_INTEGER
    return aTime - bTime || a.title.localeCompare(b.title, 'zh-CN')
  })

  return {
    document: {
      ...local,
      events,
      updatedAt: new Date().toISOString(),
    },
    changed,
  }
}

export interface SyncResult {
  document: ScheduleDocument
  sha: string
  pulled: number
  pushed: number
  mode: 'created' | 'merged' | 'unchanged'
}

export async function syncGitHub(
  config: GitHubConfig,
  local: ScheduleDocument,
): Promise<SyncResult> {
  let remote = await pullSchedule(config)
  if (!remote) {
    const sha = await pushDocument(config, local, undefined, config.branch)
    return {
      document: local,
      sha,
      pulled: 0,
      pushed: local.events.length,
      mode: 'created',
    }
  }

  const merged = mergeSchedules(local, remote.document)
  const remoteJson = JSON.stringify(remote.document.events)
  const mergedJson = JSON.stringify(merged.document.events)
  if (remoteJson === mergedJson) {
    return {
      document: merged.document,
      sha: remote.sha,
      pulled: 0,
      pushed: 0,
      mode: 'unchanged',
    }
  }

  let sha = remote.sha
  let document = merged.document
  try {
    sha = await pushDocument(config, document, sha, remote.branch)
  } catch (error) {
    // A concurrent push from another device invalidates the file SHA. Pull
    // once more, merge, and retry with the fresh SHA.
    if (!(error instanceof Error) || !/409|conflict|sha/i.test(error.message)) throw error
    remote = await pullSchedule(config)
    if (!remote) throw error
    document = mergeSchedules(document, remote.document).document
    sha = await pushDocument(config, document, remote.sha, remote.branch)
  }

  return {
    document,
    sha,
    pulled: remote.document.events.length,
    pushed: merged.changed,
    mode: 'merged',
  }
}

async function pushDocument(
  config: GitHubConfig,
  document: ScheduleDocument,
  sha: string | undefined,
  branch = config.branch,
): Promise<string> {
  let targetSha = sha
  let targetBranch = branch

  // Always resolve the existing blob first when the caller has no SHA. This
  // also covers a branch mismatch: GitHub reports "sha wasn't supplied" when
  // an update reaches an existing file without its current blob SHA.
  if (!targetSha) {
    const explicit = targetBranch ? await readFileAt(config, targetBranch) : null
    if (explicit) {
      targetSha = explicit.sha
    } else {
      const fallback = await readFileAt(config)
      if (fallback) {
        targetSha = fallback.sha
        targetBranch = ''
      }
    }
  }

  const response = await fetch(`${API}${pathFor(config)}`, {
    method: 'PUT',
    headers: {
      ...headers(config.token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: `sync: ${document.events.length} events from 阑珊时刻`,
      content: encodeBase64(JSON.stringify(document, null, 2)),
      ...(targetBranch ? { branch: targetBranch } : {}),
      ...(targetSha ? { sha: targetSha } : {}),
    }),
  })
  if (!response.ok) throw new Error(`上传云端日程失败：${await readError(response)}`)
  const payload = (await response.json()) as { content?: { sha?: string } }
  if (!payload.content?.sha) throw new Error('GitHub 没有返回新的文件 SHA')
  return payload.content.sha
}
