import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initTheme } from './lib/theme'
import { initSentry } from './lib/sentry'

initSentry()
initTheme()

declare const __BUILD_TIME__: string;
const buildHash = (import.meta.env.VITE_GIT_HASH as string | undefined)?.slice(0, 7) ?? "dev";
console.log(`Build ${buildHash} — ${__BUILD_TIME__}`);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
