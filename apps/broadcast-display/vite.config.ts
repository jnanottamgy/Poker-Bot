import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served by the game server under '/display/' in production (STATIC_DIR).
// In development, API and WebSocket calls are proxied to the local server:
//   JPB_API_TARGET=http://localhost:8108 JPB_DISPLAY_PORT=5208 npx vite
const apiTarget = process.env.JPB_API_TARGET ?? 'http://localhost:8080';
const wsTarget = apiTarget.replace(/^http/, 'ws');
const port = Number(process.env.JPB_DISPLAY_PORT ?? 5175);

export default defineConfig({
  base: '/display/',
  plugins: [react()],
  server: {
    port,
    strictPort: true,
    proxy: {
      // The server checks the WebSocket Origin against PUBLIC_BASE_URL, so the browser's origin is kept as is.
      '/api': { target: apiTarget },
      '/ws': { target: wsTarget, ws: true },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 600,
  },
});
