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
  // Vite 8 builds two independent HTML responses for SEO while keeping
  // one React application. Use rolldownOptions for Vite 8.1 build compatibility.
  build: {
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        metiers: fileURLToPath(new URL('./metiers.html', import.meta.url)),
        departmentFallback: fileURLToPath(new URL('./departement-unpublished.html', import.meta.url)),
      },
    },
  },
  plugins: [react()],
})
