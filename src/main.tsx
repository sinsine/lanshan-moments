import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './v03.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('./sw.js', window.location.href)).catch(() => {
      // Offline mode is progressive; never block the app on registration.
    })
  })
}
