import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@jpb/ui/styles.css';
import './styles/app.css';
import { websocketUrl } from '@jpb/client-sdk';
import { createPlayerApi } from './api/client';
import { App } from './app/App';
import type { Backend } from './app/backend';

async function createBackend(): Promise<Backend> {
  if (import.meta.env.VITE_MOCK === '1') {
    // Loaded only in mock mode: production bundles never contain the mock server.
    const { createMockBackend } = await import('./mock');
    const mock = createMockBackend(window.location.search);
    return {
      mode: 'mock',
      api: createPlayerApi({ fetchImpl: mock.fetchImpl }),
      wsUrl: 'ws://mock.local/ws',
      socketFactory: mock.socketFactory,
      demo: { joinCode: mock.joinCode, scenario: mock.scenario.id },
    };
  }
  return { mode: 'live', api: createPlayerApi(), wsUrl: websocketUrl('/ws') };
}

const root = document.getElementById('root');
if (root) {
  document.body.classList.add('jpb-app');
  void createBackend().then((backend) => {
    createRoot(root).render(
      <StrictMode>
        <App backend={backend} />
      </StrictMode>,
    );
  });
}
