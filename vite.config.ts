import { defineConfig } from "vite";
import { execSync } from "child_process";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import wasm from "vite-plugin-wasm";
import inject from "@rollup/plugin-inject";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import type { Plugin } from "vite";
import pkg from "./package.json";

function git(cmd: string): string {
  try { return execSync(cmd, { encoding: "utf8" }).trim(); } catch { return ""; }
}

const gitHash = (process.env.VITE_GIT_HASH || git("git rev-parse --short=7 HEAD")).slice(0, 7);
const gitTag = process.env.VITE_GIT_TAG || git("git describe --tags --exact-match 2>/dev/null");

// cb-mpc's native (bun:ffi / koffi) backend points at prebuilt .so/.dylib files through
// `new URL(\`../../prebuilds/${platform}...\`, import.meta.url)`; Vite would copy every prebuild
// (~100 MB, one file over Cloudflare Pages' 25 MiB limit) into the web build. The browser only
// uses the WASM backend, so drop that URL from the bundle.
const dropCbMpcNativePrebuilds: Plugin = {
  name: "drop-cb-mpc-native-prebuilds",
  enforce: "pre",
  transform(code: string, id: string) {
    if (!/cb-mpc[\\/]dist[\\/]backends[\\/]native\.js$/.test(id)) return null;
    const out = code.replace(
      /new URL\(`\.\.\/\.\.\/prebuilds\/[^`]*`,\s*import\.meta\.url\)/,
      '(() => { throw new Error("cb-mpc native backend is not available in the browser"); })()',
    );
    if (out === code) throw new Error("cb-mpc native prebuild URL not found; update dropCbMpcNativePrebuilds");
    return { code: out, map: null };
  },
};

export default defineConfig({
  base: "/",
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __GIT_HASH__: JSON.stringify(gitHash),
    __GIT_TAG__: JSON.stringify(gitTag),
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    dropCbMpcNativePrebuilds,
    react(),
    tailwindcss(),
    wasm(),
    sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT_FRONTEND,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      release: { name: process.env.VITE_GIT_TAG || process.env.VITE_GIT_HASH },
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
      plugins: [
        // Auto-inject `import { Buffer } from 'buffer'` wherever Buffer is used.
        // This ensures @ton/core gets Buffer resolved by Rollup (not bare specifier).
        inject({ Buffer: ["buffer", "Buffer"] }),
      ],
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
