export {};

declare global {
  interface Window {
    /** Pure logic core attached by ./logic.js (also set on globalThis for tests). */
    ExplodexProjectGroupsCore?: any;
    /** Self-reporting reconcile timings; see index.js recordTiming(). */
    __explodexPgDebug?: unknown[];
  }
}
