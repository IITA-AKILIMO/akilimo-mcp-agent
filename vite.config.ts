import { defineConfig } from 'vite';
import { builtinModules } from 'module';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['cjs', 'es'],
      fileName: 'index',
    },
    rollupOptions: {
      external: [
        ...builtinModules,
        ...builtinModules.map(m => `node:${m}`),
        '@modelcontextprotocol/sdk',
        'axios',
        'express',
        'zod',
      ],
    },
    target: 'node20',
    ssr: true,
  },
  ssr: {
    noExternal: true,
  },
});
