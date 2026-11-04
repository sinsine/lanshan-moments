import { APP_VERSION, REPO_URL } from './config'

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

export async function checkLatestRelease(): Promise<UpdateInfo> {
  const response = await fetch(
    `https://api.github.com/repos/sinsine/lanshan-moments/releases/latest`,
    { headers: { Accept: 'application/vnd.github+json' } },
  )
  if (!response.ok) throw new Error(`检查更新失败：${response.status}`)
  const payload = (await response.json()) as {
    tag_name?: string
    html_url?: string
    name?: string
  }
  const latest = payload.tag_name?.replace(/^v/i, '') || APP_VERSION
  return {
    current: APP_VERSION,
    latest,
    url: payload.html_url || `${REPO_URL}/releases`,
    isNewer: isNewerVersion(latest, APP_VERSION),
  }
}
