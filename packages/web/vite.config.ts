import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type ProxyOptions } from 'vite'

// The browser reaches everything through same-origin paths, which avoids CORS (Akilimo 2.0 and
// Ollama reject cross-origin requests). packages/web/nginx.conf mirrors this in Docker.
const mcpProxy = (env: Record<string, string>): Record<string, ProxyOptions> => {
  const proxy = (prefix: string, target: string): ProxyOptions => ({
    target,
    changeOrigin: true,
    rewrite: (path) => path.slice(prefix.length),
  })
  return {
    // MCP gateway on the Akilimo 1.0 server: server registry plus a proxy to every registered server
    '/gateway': { target: env.AKILIMO_1_MCP_URL || 'http://localhost:3001', changeOrigin: true },
    // Accounts, saved chats and activity on the same server
    '/api': { target: env.AKILIMO_1_MCP_URL || 'http://localhost:3001', changeOrigin: true },
    // Chat on the same server: provider settings and the model/tool loop (streams, so no buffering)
    '/chat': { target: env.AKILIMO_1_MCP_URL || 'http://localhost:3001', changeOrigin: true },
    // Ollama answers 403 to browser origins outside OLLAMA_ORIGINS, so the proxy drops the header
    '/proxy/ollama': {
      ...proxy('/proxy/ollama', env.OLLAMA_URL || 'http://localhost:11434'),
      configure: (p) => p.on('proxyReq', (req) => req.removeHeader('origin')),
    },
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
