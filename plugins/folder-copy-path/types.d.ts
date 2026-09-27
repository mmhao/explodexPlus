export {};

declare global {
  interface Window {
    /** Pure logic core attached by ./logic.js (also set on globalThis for tests). */
    ExplodexFolderCopyPathCore?: any;
    /** Debug ring buffer of recent path resolutions, written by index.js. */
    __explodexFcpDebug?: { absolute: string; tag: string; cls: string }[];
    /** Ring buffer of recent folder-path resolutions, for live diagnostics. */
    __explodexFcpDebug?: { absolute: string; tag: string; cls: string }[];
  }
}
