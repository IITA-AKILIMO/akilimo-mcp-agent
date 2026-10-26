import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type ProxyOptions } from 'vite'

// The browser talks to MCP servers through same-origin /proxy/<server-id>/ paths, which avoids
// CORS (Akilimo 2.0 rejects cross-origin preflights). packages/web/nginx.conf mirrors this in Docker.
const mcpProxy = (env: Record<string, string>): Record<string, ProxyOptions> => {
  const proxy = (prefix: string, target: string): ProxyOptions => ({
    target,
    changeOrigin: true,
    rewrite: (path) => path.slice(prefix.length),
  })
  return {
    '/proxy/akilimo-1.0': proxy('/proxy/akilimo-1.0', env.AKILIMO_1_MCP_URL || 'http://localhost:3001'),
    '/proxy/akilimo-2.0': proxy('/proxy/akilimo-2.0', env.AKILIMO_2_MCP_URL || 'https://mcp.akilimo.org'),
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react()],
    server: { proxy: mcpProxy(env) },
    preview: { proxy: mcpProxy(env) },
  }
})
