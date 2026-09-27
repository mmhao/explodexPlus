export {};

declare global {
  interface Window {
    /** Pure logic core attached by ./logic.js (also set on globalThis for tests). */
    ExplodexFolderCopyPathCore?: any;
    /** Ring buffer of recent path resolutions (and context-menu misses), written by index.js. */
    __explodexFcpDebug?: (
      | { absolute: string; tag: string; cls: string; miss?: undefined }
      | { absolute: null; miss: string[]; tag?: undefined; cls?: undefined }
    )[];
    /** One-time dump of the file-tree shadow DOM structure, for live triage. */
    __explodexFcpShadowDump?: unknown;
    /** One-time structured dump of the first file-tree right-click composedPath. */
    __explodexFcpPathDump?: unknown;
  }
}
