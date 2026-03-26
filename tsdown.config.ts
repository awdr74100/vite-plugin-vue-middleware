import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['./src/index.ts', './src/runtime.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  bundle: false,
  deps: {
    neverBundle: ['vite', 'vue-router', 'vue', 'node:fs', 'node:path'],
  },
  clean: true,
});
