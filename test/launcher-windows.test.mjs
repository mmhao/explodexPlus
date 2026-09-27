import { describe, expect, test } from "bun:test";
import {
  buildCmdWrapper,
  buildShortcutScript,
  desktopLnkPath,
  startMenuLnkPath,
  wrapperCmdPath,
} from "../lib/launcher-windows.mjs";

describe("cmd wrapper", () => {
  test("embeds node, cli script, and debug port via env var", () => {
    const cmd = buildCmdWrapper({
      nodeExe: "C:\\nodejs\\node.exe",
      cliScript: "H:\\explodexPlus\\bin\\explodex.mjs",
      port: 9400,
    });
    expect(cmd).toMatch(/^@echo off\r\n/);
    expect(cmd).toContain('set "EXPLODEX_DEBUG_PORT=9400"');
    expect(cmd).toContain('"C:\\nodejs\\node.exe" "H:\\explodexPlus\\bin\\explodex.mjs" --launch');
    expect(cmd).toContain("if errorlevel 1 pause");
  });
  test("falls back to the default port", () => {
    expect(buildCmdWrapper({ nodeExe: "node", cliScript: "cli.mjs" })).toContain("EXPLODEX_DEBUG_PORT=9333");
  });
  test("normalizes forward slashes to Windows separators", () => {
    const cmd = buildCmdWrapper({ nodeExe: "node", cliScript: "H:/code/explodex/bin/explodex.mjs" });
    expect(cmd).toContain('"H:\\code\\explodex\\bin\\explodex.mjs"');
    expect(cmd).not.toContain("H:/code");
  });
});

describe("shortcut script", () => {
  test("escapes single quotes in paths", () => {
    const script = buildShortcutScript({
      cmdPath: "C:\\o'brien\\.explodex\\x.cmd",
      lnkPath: "C:\\Users\\me\\Desktop\\Codex (Explodex).lnk",
    });
    expect(script).toContain("CreateShortcut");
    expect(script).toContain("C:\\o''brien");
    expect(script).toContain("$sc.TargetPath = 'C:\\o''brien\\.explodex\\x.cmd'");
    expect(script).toContain("$sc.Save()");
  });
});

describe("launcher locations", () => {
  test("are per-user and carry the launcher name", () => {
    const home = "C:\\Users\\tester";
    expect(startMenuLnkPath(home)).toContain(
      joinAll(home, ["AppData", "Roaming", "Microsoft", "Windows", "Start Menu", "Programs"]),
    );
    expect(desktopLnkPath(home)).toContain("Desktop");
    expect(wrapperCmdPath(home)).toContain(".explodex");
    for (const p of [startMenuLnkPath(home), desktopLnkPath(home), wrapperCmdPath(home)]) {
      expect(p.endsWith(".lnk") || p.endsWith(".cmd")).toBe(true);
      expect(p).toContain("Codex (Explodex)");
    }
  });
});

function joinAll(home, segments) {
  return [home, ...segments].join("\\");
}
