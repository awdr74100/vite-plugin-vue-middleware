import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import vueDevTools from 'vite-plugin-vue-devtools';
import metaLayouts from 'vite-plugin-vue-meta-layouts';
import vueMiddleware from 'vite-plugin-vue-middleware';
import vueRouter from 'vue-router/vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vueRouter({
      dts: fileURLToPath(new URL('./src/types/typed-router.d.ts', import.meta.url)),
    }),
    vue(),
    vueDevTools(),
    metaLayouts(),
    vueMiddleware({
      dts: fileURLToPath(new URL('./src/types/middleware.d.ts', import.meta.url)),
    }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
