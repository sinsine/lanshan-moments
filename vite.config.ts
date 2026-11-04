import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Relative base keeps the demo working at both `/` and `/<repo>/` on GitHub Pages.
export default defineConfig({
  base: './',
  plugins: [react()],
})
