import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The API limits requests for each client (server/src/api/rateLimit.ts). All
// production requests come to the API from this proxy, so the proxy sends the
// address of the client in a header. The secret shows the API that the header
// comes from this proxy. Keep these names the same as in rateLimit.ts.
const PROXY_SECRET_HEADER = 'x-rotunda-proxy-secret'
const PROXY_CLIENT_IP_HEADER = 'x-rotunda-client-ip'

type ProxiedRequest = {
  headers: Record<string, string | string[] | undefined>
  socket: { remoteAddress?: string }
}

// The Railway edge sets X-Real-IP to the address of the client.
function clientAddress(req: ProxiedRequest): string {
  const realIp = req.headers['x-real-ip']
  return (Array.isArray(realIp) ? realIp[0] : realIp)?.trim() || req.socket.remoteAddress || 'unknown'
}

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
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            // Remove the values that the client sent. Then add the real values.
            proxyReq.removeHeader(PROXY_SECRET_HEADER)
            proxyReq.removeHeader(PROXY_CLIENT_IP_HEADER)
            const secret = process.env.API_PROXY_SECRET
            if (!secret) return
            proxyReq.setHeader(PROXY_SECRET_HEADER, secret)
            proxyReq.setHeader(PROXY_CLIENT_IP_HEADER, clientAddress(req))
          })
        },
      },
    },
  },
})
