import { APP_VERSION, REPO_URL } from './config'
import { nativeGitHubRequest } from './native'

export interface UpdateInfo {
  current: string
  latest: string
  url: string
  isNewer: boolean
}

function normalize(version: string): number[] {
  return version
    .replace(/^v/i, '')
    .split(/[.+-]/)
    .map((part) => Number(part) || 0)
}

export function isNewerVersion(latest: string, current: string): boolean {
  const a = normalize(latest)
  const b = normalize(current)
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    const left = a[index] ?? 0
    const right = b[index] ?? 0
    if (left > right) return true
    if (left < right) return false
  }
  return false
}

async function nativeReleaseInfo(): Promise<{ latest: string; url: string } | null> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 4000)
  try {
    const response = await fetch('/api/update', {
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!response.ok) return null
    if (!(response.headers.get('content-type') ?? '').includes('application/json')) {
      return null
    }
    const payload = (await response.json()) as {
      ok?: boolean
      latest?: string
      url?: string
    }
    if (!payload.ok || !payload.latest) return null
    return {
      latest: payload.latest.replace(/^v/i, ''),
      url: payload.url || `${REPO_URL}/releases`,
    }
  } catch {
    return null
  } finally {
    window.clearTimeout(timer)
  }
}

function toUpdateInfo(latest: string, url: string): UpdateInfo {
  const version = latest.replace(/^v/i, '')
  return {
    current: APP_VERSION,
    latest: version,
    url: url || `${REPO_URL}/releases`,
    isNewer: isNewerVersion(version, APP_VERSION),
  }
}

export async function checkLatestRelease(token = ''): Promise<UpdateInfo> {
  // With a token the API proxy is fast and has a much higher rate limit.
  // Without a token, prefer GitHub's public redirect page so anonymous API
  // quota (403) cannot block the update check.
  let page: { latest: string; url: string } | null = null
  let pageTried = false
  if (!token) {
    pageTried = true
    page = await nativeReleaseInfo()
    if (page) return toUpdateInfo(page.latest, page.url)
  }

  const url = `https://api.github.com/repos/sinsine/lanshan-moments/releases/latest`
  let payload: { tag_name?: string; html_url?: string; name?: string }

  const native = await nativeGitHubRequest('GET', url, '', 'application/json', token)
  if (native) {
    if (native.status === 403) {
      if (!pageTried) {
        pageTried = true
        page = await nativeReleaseInfo()
      }
      if (page) return toUpdateInfo(page.latest, page.url)
      throw new Error(
        '检查更新失败：403（GitHub API 速率限制）。请在设置里连接 GitHub 后重试，或稍后再试。',
      )
    }
    if (native.status < 200 || native.status >= 300) {
      throw new Error(`检查更新失败：${native.status}`)
    }
    try {
      payload = JSON.parse(native.body) as typeof payload
    } catch {
      throw new Error('检查更新失败：GitHub 返回了无法解析的内容')
    }
  } else {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      cache: 'no-store',
    })
    if (response.status === 403) {
      if (!pageTried) {
        pageTried = true
        page = await nativeReleaseInfo()
      }
      if (page) return toUpdateInfo(page.latest, page.url)
      throw new Error(
        '检查更新失败：403（GitHub API 速率限制）。请配置 GitHub Token 后重试，或稍后再试。',
      )
    }
    if (!response.ok) throw new Error(`检查更新失败：${response.status}`)
    payload = (await response.json()) as typeof payload
  }

  return toUpdateInfo(payload.tag_name ?? APP_VERSION, payload.html_url ?? `${REPO_URL}/releases`)
}
