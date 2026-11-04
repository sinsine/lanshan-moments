/**
 * Thin bridge to the Windows shell (Wails) and Android (CapacitorHttp).
 *
 * GitHub's device-flow endpoints do not send CORS headers, so a plain
 * browser fetch cannot complete the flow. Native shells can make the same
 * requests outside the WebView's CORS rules; the web demo falls back to a
 * personal access token.
 */

export interface NativeHttpResponse {
  status: number
  body: string
}

interface WailsBridge {
  GitHubRequest: (
    method: string,
    url: string,
    body: string,
    contentType: string,
    token: string,
  ) => Promise<{ status?: number; body?: string; Status?: number; Body?: string }>
  OpenExternal?: (url: string) => Promise<void>
}

function wailsBridge(): WailsBridge | null {
  const candidate = (window as unknown as { go?: { main?: { App?: WailsBridge } } }).go?.main?.App
  return candidate?.GitHubRequest ? candidate : null
}

export function hasNativeGitHubBridge(): boolean {
  return Boolean(wailsBridge()) || Boolean((window as unknown as { Capacitor?: unknown }).Capacitor)
}

export async function nativeGitHubRequest(
  method: 'GET' | 'POST',
  url: string,
  body: string,
  contentType: string,
  token = '',
): Promise<NativeHttpResponse | null> {
  const wails = wailsBridge()
  if (wails) {
    const result = await wails.GitHubRequest(method, url, body, contentType, token)
    return {
      status: result.status ?? result.Status ?? 500,
      body: result.body ?? result.Body ?? '',
    }
  }

  const capacitor = (window as unknown as {
    Capacitor?: { Plugins?: { CapacitorHttp?: { request: (options: unknown) => Promise<unknown> } } }
  }).Capacitor
  const http = capacitor?.Plugins?.CapacitorHttp
  if (http) {
    const result = (await http.request({
      url,
      method,
      headers: {
        Accept: url.startsWith('https://api.github.com') ? 'application/vnd.github+json' : 'application/json',
        'Content-Type': contentType,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(url.startsWith('https://api.github.com') ? { 'X-GitHub-Api-Version': '2022-11-28' } : {}),
      },
      data: body || undefined,
      responseType: 'text',
    })) as { status?: number; data?: unknown }
    return {
      status: Number(result.status) || 500,
      body: typeof result.data === 'string' ? result.data : JSON.stringify(result.data ?? ''),
    }
  }

  return null
}

export async function openExternal(url: string): Promise<void> {
  const wails = wailsBridge()
  if (wails?.OpenExternal) {
    await wails.OpenExternal(url)
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}
