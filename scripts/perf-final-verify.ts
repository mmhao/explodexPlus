/**
 * FINAL verification (raw CDP, 120s timeout): one self-contained evaluate
 * installs counters, watches a full refresh window, ALWAYS restores, and
 * diffs hints integrity. No cross-script JSON.parse pollution possible.
 * Usage: node_modules\.bin\bun scripts\perf-final-verify.ts [seconds]
 */
import { getTargets, injectablePages } from "./cdp-client.ts";

const SECONDS = Number(process.argv[2] ?? 75);
const pages = injectablePages(await getTargets());
const ws = new WebSocket(pages[0].webSocketDebuggerUrl!);
await new Promise<void>((res, rej) => {
  ws.onopen = () => res();
  ws.onerror = () => rej(new Error("ws failed"));
});

let msgId = 0;
const pending = new Map<number, (v: any) => void>();
ws.onmessage = (ev) => {
  try {
    const d = JSON.parse(String(ev.data));
    const cb = pending.get(d.id);
    if (cb) {
      pending.delete(d.id);
      cb(d);
    }
  } catch {
    /* ignore */
  }
};
function send(method: string, params: Record<string, unknown>, timeoutMs = 180_000): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    const timer = setTimeout(() => reject(new Error(method + " timeout")), timeoutMs);
    pending.set(id, (d: any) => {
      clearTimeout(timer);
      d.error ? reject(new Error(d.error.message)) : resolve(d.result);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const resp = await send("Runtime.evaluate", {
  expression: `(async () => {
  const HINTS_KEY = "codex:persisted-atom:explodex-feature-flags-playground-gate-hints";
  const out = { nativeBefore: String(JSON.parse).startsWith("function parse") };

  const rawBefore = localStorage.getItem(HINTS_KEY);
  out.hintsBytesBefore = rawBefore ? rawBefore.length : null;
  try { out.hintsFeaturesBefore = rawBefore ? Object.keys(JSON.parse(rawBefore)).length : null; }
  catch (e) { out.hintsBeforeErr = String(e).slice(0, 80); }

  const origParse = JSON.parse;
  const origSet = Storage.prototype.setItem;
  let parses = 0, hintWrites = 0;
  const stacks = {};
  const longtasks = [];
  let po = null;
  try {
    JSON.parse = function (text, ...rest) {
      if (typeof text === "string" && text.length > 100_000) {
        parses += 1;
        const st = (new Error().stack || "").split("\\n").slice(2, 4)
          .map((l) => l.trim().slice(0, 120)).join(" <- ");
        stacks[st] = (stacks[st] || 0) + 1;
      }
      return origParse.call(this, text, ...rest);
    };
    Storage.prototype.setItem = function (k, v) {
      if (String(k).includes("gate-hints")) hintWrites += 1;
      return origSet.call(this, k, v);
    };
    po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) longtasks.push({ t: Math.round(e.startTime), d: Math.round(e.duration) });
    });
    po.observe({ type: "longtask", buffered: false });

    await new Promise((r) => setTimeout(r, ${SECONDS * 1000}));

    out.elapsedS = ${SECONDS};
    out.bigParses = parses;
    out.parseStacks = stacks;
    out.hintWrites = hintWrites;
    out.longtasks = longtasks.filter((t) => t.d >= 50);
  } finally {
    JSON.parse = origParse;
    Storage.prototype.setItem = origSet;
    if (po) po.disconnect();
  }

  out.nativeAfter = String(JSON.parse).startsWith("function parse");
  const rawAfter = localStorage.getItem(HINTS_KEY);
  out.hintsBytesAfter = rawAfter ? rawAfter.length : null;
  try { out.hintsFeaturesAfter = rawAfter ? Object.keys(JSON.parse(rawAfter)).length : null; }
  catch (e) { out.hintsAfterErr = String(e).slice(0, 80); }
  out.label = [...document.querySelectorAll("button")].map((b) => b.textContent)
    .find((t) => /^Flags: /.test(t || ""));
  return out;
})()`,
  returnByValue: true,
  awaitPromise: true,
});
ws.close();

const val = resp?.result?.value;
if (val == null) {
  console.log("EVAL FAILED:", JSON.stringify(resp).slice(0, 800));
} else {
  console.log(JSON.stringify(val, null, 2));
}
