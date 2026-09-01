// Migrate legacy `mms-*` storage keys to `ris-*` BEFORE any Zustand store
// hydrates — otherwise persisted UI prefs / language / form drafts get
// orphaned on the first load after the rebrand. Importing first means the
// shim's side-effect runs at module-evaluation time, before App/store imports.
import './lib/storage-migration-runner'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

async function bootstrap(): Promise<void> {
  if (import.meta.env.DEV) {
    const { worker } = await import('./mocks/browser');
    await worker.start({ onUnhandledRequest: 'bypass' });
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();

// Core Web Vitals measurement (production only)
if (import.meta.env.PROD) {
  import('web-vitals').then(({ onCLS, onFCP, onLCP, onTTFB, onINP }) => {
    const report = (metric: { name: string; value: number }): void => {
      console.debug('[web-vitals]', metric.name, metric.value.toFixed(1));
    };
    onCLS(report);
    onFCP(report);
    onLCP(report);
    onTTFB(report);
    onINP(report);
  });
}
