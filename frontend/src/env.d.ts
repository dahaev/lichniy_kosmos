/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" enables MSW in the dev server (npm run dev). */
  readonly VITE_API_MOCKS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
