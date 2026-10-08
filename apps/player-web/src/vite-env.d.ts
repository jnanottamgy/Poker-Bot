/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" runs the app against the in-browser mock backend (npx vite --mode mock). */
  readonly VITE_MOCK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
