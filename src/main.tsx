import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initTheme } from './lib/theme'
import { initSentry } from './lib/sentry'

initSentry()
initTheme()

declare const __BUILD_TIME__: string;
const tag = import.meta.env.VITE_GIT_TAG as string | undefined;
const hash = (import.meta.env.VITE_GIT_HASH as string | undefined)?.slice(0, 7);
const version = tag ? `Version ${tag}` : hash ? `Build ${hash}` : "Build dev";
console.log(`${version} — ${__BUILD_TIME__}`);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
