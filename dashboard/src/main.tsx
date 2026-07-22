import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyTheme, getTheme } from './lib/theme';
import { LT_BASE } from './lib/base-path';
import './styles/globals.css';

applyTheme(getTheme());

// Deployment design-system overrides (branding.customCss + registered themes).
// Loaded after the bundled stylesheet so registered CSS wins the cascade at
// equal specificity. Always present — the endpoint serves empty CSS when
// nothing is registered.
const customCss = document.createElement('link');
customCss.rel = 'stylesheet';
customCss.href = `${LT_BASE}/api/settings/custom.css`;
document.head.appendChild(customCss);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
