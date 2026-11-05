import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './v03.css'
import './dock.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

async function isNativeShell(): Promise<boolean> {
  try {
    const response = await fetch('/api/health', { cache: 'no-store' })
    if (!response.ok) return false
    if (!(response.headers.get('content-type') ?? '').includes('application/json')) {
      return false
    }
    const payload = (await response.json()) as { native?: boolean }
    return Boolean(payload.native)
  } catch {
    return false
  }
}

async function setupServiceWorker() {
  // The Wails shell embeds its assets and owns the /api window bridge. A
  // service worker there can replay an old UI after an update and freeze
  // /api/state, so clean up any legacy registration instead of registering.
  if (await isNativeShell()) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(registrations.map((registration) => registration.unregister()))
      if ('caches' in window) {
        const keys = await caches.keys()
        await Promise.all(keys.map((key) => caches.delete(key)))
      }
    } catch {
      // Best-effort cleanup.
    }
    return
  }

  try {
    await navigator.serviceWorker.register(new URL('./sw.js', window.location.href))
  } catch {
    // Offline mode is progressive; never block the app on registration.
  }
}

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void setupServiceWorker()
  })
}
