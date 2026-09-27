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
      external: ['koffi', 'node:fs/promises', 'node:path', 'node:url'],
    },
  },
})
