import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss(), wasm()],
  build: {
    rollupOptions: {
      external: [/^node:/, /^bun:/],
    },
  },
server: {
    allowedHosts: ["m4.kha.do"],
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
