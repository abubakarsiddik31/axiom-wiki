import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Builds into the CLI package's dist/web so `axiom-wiki serve` can ship the SPA
// with the npm package. During development, proxy API calls to a running
// `axiom-wiki serve` (default port 1717).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
  },
  server: {
    port: 1718,
    proxy: {
      '/api': 'http://127.0.0.1:1717',
      '/healthz': 'http://127.0.0.1:1717',
    },
  },
})
