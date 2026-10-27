import { defineConfig } from 'vite';
import { builtinModules } from 'module';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['cjs'],
      fileName: 'index',
    },
    rollupOptions: {
      external: [
        ...builtinModules,
        ...builtinModules.map(m => `node:${m}`),
        /^@modelcontextprotocol\/sdk(\/|$)/,
        'axios',
        'express',
        /^zod(\/|$)/,
        'cors',
        // Prisma runtime and database drivers stay in node_modules (better-sqlite3 is native)
        /^@prisma\//,
        'pg',
        'better-sqlite3',
      ],
    },
    target: 'node20',
    ssr: true,
  },
  ssr: {
    noExternal: true,
  },
});
