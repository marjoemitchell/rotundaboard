import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  preview: {
    // `vite preview` rejects requests with an unrecognized Host header by
    // default (DNS-rebinding protection) — this is the production server on
    // Railway, reached only via Railway's own routed domain, so there's no
    // untrusted-host risk in allowing all here.
    allowedHosts: true,
    // Proxying /api same-origin (instead of the frontend calling the API's
    // own separate Railway domain directly) is what makes the session
    // cookie work at all in production: browsers that block third-party
    // cookies (Safari always, Chromium increasingly) drop a cookie set by
    // a cross-site fetch even with SameSite=None — this was confirmed
    // broken in testing before adding the proxy. Routing through the
    // frontend's own origin makes every request same-origin from the
    // browser's point of view.
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET ?? 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
})
