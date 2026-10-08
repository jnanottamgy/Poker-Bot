import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served by the game server under '/display/' in production (STATIC_DIR).
// In development, API and WebSocket calls are proxied to the local server.
export default defineConfig({
  base: '/display/',
  plugins: [react()],
  server: {
    port: 5175,
    proxy: {
      '/api': 'http://localhost:8080',
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 600,
  },
});
