import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

/** Component gallery: `npx vite packages/ui/gallery` (or `npm run gallery -w @jpb/ui`). */
export default defineConfig({
  root: here,
  plugins: [react()],
  server: { fs: { allow: [repoRoot] } },
  build: { outDir: fileURLToPath(new URL('./dist', import.meta.url)), emptyOutDir: true },
  logLevel: 'warn',
});
