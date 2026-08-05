import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'MaceNode',
      fileName: 'index',
      formats: ['es'],
    },
    rollupOptions: {
      external: ['node:child_process', 'node:fs/promises', 'node:os', 'node:path'],
    },
  },
})
