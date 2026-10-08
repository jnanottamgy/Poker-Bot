import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@jpb/ui/styles.css';
import './styles/app.css';
import { createRealBackend } from './api/backend';
import type { Backend } from './api/backend';
import { App } from './app/App';
import { IS_MOCK } from './env';

async function createBackend(): Promise<Backend> {
  if (!IS_MOCK) return createRealBackend();
  // Mock code is only loaded (and only bundled as a separate chunk) in mock mode.
  const { createMockBackend } = await import('./api/mock');
  const mock = createMockBackend();
  // Demo/screenshot hook: simulate a network drop for N ms (the UI must grey out and say "not live").
  (window as unknown as { __jpbMock?: unknown }).__jpbMock = { drop: (ms?: number) => mock.hub.drop(ms), server: mock.server };
  return mock.backend;
}

document.body.classList.add('jpb-app');
const backend = await createBackend();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App backend={backend} />
  </StrictMode>,
);
