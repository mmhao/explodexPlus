export {};

declare global {
  interface Window {
    /** Pure logic core attached by ./logic.js (also set on globalThis for tests). */
    ExplodexFolderCopyPathCore?: any;
  }
}
