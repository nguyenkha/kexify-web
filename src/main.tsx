import { Buffer } from 'buffer'
globalThis.Buffer = Buffer

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './i18n/i18n'
import App from './App.tsx'
import { initTheme } from './lib/theme'
import { initSentry } from './lib/sentry'
import { initAlgoAdapter } from './lib/chains/algoAdapter'
import { initAdaAdapter } from './lib/chains/adaAdapter'

initSentry()
initTheme()
initAlgoAdapter()
initAdaAdapter()

declare const __BUILD_TIME__: string;
declare const __GIT_HASH__: string;
declare const __GIT_TAG__: string;
const version = __GIT_TAG__ || (__GIT_HASH__ ? `Build ${__GIT_HASH__}` : "Build dev");
console.log(`${version} — ${__BUILD_TIME__}`);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
