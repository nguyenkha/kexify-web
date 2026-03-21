import { defineConfig } from "vite";
import { execSync } from "child_process";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import wasm from "vite-plugin-wasm";
import { sentryVitePlugin } from "@sentry/vite-plugin";


function git(cmd: string): string {
  try { return execSync(cmd, { encoding: "utf8" }).trim(); } catch { return ""; }
}

const gitHash = (process.env.VITE_GIT_HASH || git("git rev-parse --short=7 HEAD")).slice(0, 7);
const gitTag = process.env.VITE_GIT_TAG || git("git describe --tags --exact-match 2>/dev/null");
export default defineConfig({
  base: "/",
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __GIT_HASH__: JSON.stringify(gitHash),
    __GIT_TAG__: JSON.stringify(gitTag),
  },
  plugins: [
    react(),
    tailwindcss(),
    wasm(),
    sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT_FRONTEND,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      release: { name: process.env.VITE_GIT_HASH },
      sourcemaps: {
        filesToDeleteAfterUpload: ["./dist/**/*.map"],
      },
      disable: !process.env.SENTRY_AUTH_TOKEN,
    }),
  ],
  optimizeDeps: {
    include: ["buffer", "@ton/core"],
    esbuildOptions: {
      inject: ["./src/buffer-shim.ts"],
    },
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      external: [/^node:/, /^bun:/],
      output: {
        // Inject Buffer polyfill at the very start of each chunk, before any module code runs.
        // This is needed because @ton/core uses Buffer at module-level evaluation time.
        banner: `import{Buffer as __B}from"buffer";globalThis.Buffer=__B;`,
      },
    },
  },
server: {
    allowedHosts: ["m4.kha.do"],
    watch: {
      // Ignore non-frontend files to prevent spurious full-page reloads
      ignored: ["**/backend/**", "**/plans/**", "**/.claude/**", "**/node_modules/**", "**/db-dump.sql"],
    },
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
