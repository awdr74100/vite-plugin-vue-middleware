import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import vueRouter from "vue-router/vite";
import vueDevTools from "vite-plugin-vue-devtools";
import MetaLayouts from "vite-plugin-vue-meta-layouts";
import vueMiddleware from "vite-plugin-vue-middleware";
// import middleware from "vite-plugin-vue-middleware";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vueRouter({
      dts: fileURLToPath(
        new URL("./src/types/typed-router.d.ts", import.meta.url)
      ),
    }),
    vue(),
    vueDevTools(),
    MetaLayouts(),
    vueMiddleware({
      dts: fileURLToPath(
        new URL("./src/types/middleware.d.ts", import.meta.url)
      ),
    })
    // vueMiddleware({
    //   middlewareDir: "src/middleware",
    //   dts: "src/types/middleware.d.ts",
    // }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
