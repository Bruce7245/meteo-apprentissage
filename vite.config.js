import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
    tsconfigPaths: true,
  },
  // Each public landing page gets its own crawlers-readable HTML document.
  // Both pages still mount the same React application and hashed JS/CSS bundle.
  input: {
    main: fileURLToPath(new URL('./index.html', import.meta.url)),
    metiers: fileURLToPath(new URL('./metiers.html', import.meta.url)),
  },
  plugins: [react()],
})
