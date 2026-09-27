import { describe, expect, test } from "bun:test";
import { win32 } from "node:path";
import {
  appxDiscoveryScript,
  parseAppxPackage,
  parsePortOwners,
  portOwnedByCodex,
  parseCodexRunning,
  debugPortArg,
  startProcessScript,
  installedCodexEnvironment,
} from "../lib/platform/windows.mjs";

describe("MSIX package discovery", () => {
  test("parses InstallLocation into a UI executable path", () => {
    const json = JSON.stringify({
      PackageName: "OpenAI.Codex",
      PackageFamilyName: "OpenAI.Codex_2p2nqsd0c76g0",
      Version: "26.924.2738.0",
      InstallLocation: "C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.924.2738.0_x64__2p2nqsd0c76g0\\",
    });
    const codex = parseAppxPackage(json);
    expect(codex.version).toBe("26.924.2738.0");
    expect(codex.installLocation.endsWith("2p2nqsd0c76g0")).toBe(true);
    expect(codex.uiExecutable).toBe(win32.join(codex.installLocation, "app", "ChatGPT.exe"));
  });

  test("returns null when the package is missing", () => {
    expect(parseAppxPackage('{"missing":true}')).toBeNull();
    expect(parseAppxPackage("")).toBeNull();
    expect(parseAppxPackage('{"InstallLocation":""}')).toBeNull();
  });

  test("discovery script uses the stable family name, not the versioned path", () => {
    const script = appxDiscoveryScript("OpenAI.Codex");
    expect(script).toContain("Get-AppxPackage");
    expect(script).toContain("'OpenAI.Codex'");
    expect(script).not.toMatch(/26\.924/);
  });
});

describe("port ownership", () => {
  test("parses single and array owner payloads", () => {
    expect(parsePortOwners('[{"pid":111,"path":"C:\\\\x\\\\ChatGPT.exe"}]')).toHaveLength(1);
    expect(parsePortOwners('{"pid":222,"path":"C:\\\\y.exe"}')).toHaveLength(1);
    expect(parsePortOwners("null")).toHaveLength(0);
  });

  test("attributes a ChatGPT.exe owner to Codex", () => {
    const owners = [{ pid: 1, path: "C:\\Program Files\\WindowsApps\\app\\ChatGPT.exe", args: "ChatGPT.exe --remote-debugging-port=9333" }];
    expect(portOwnedByCodex(owners, { uiExecutable: "C:\\anything\\app\\ChatGPT.exe" })).toBe(true);
  });

  test("does not attribute a foreign owner to Codex", () => {
    const owners = [{ pid: 9, path: "C:\\tools\\node.exe", args: "node server.js" }];
    expect(portOwnedByCodex(owners, { uiExecutable: "C\\app\\ChatGPT.exe" })).toBe(false);
  });
});

describe("codex running detection", () => {
  test("true for ChatGPT or Codex process names", () => {
    expect(parseCodexRunning('["ChatGPT","chrome"]')).toBe(true);
    expect(parseCodexRunning('{"ProcessName":"codex-windows-sandbox-service"}')).toBe(true);
  });
  test("false when empty", () => {
    expect(parseCodexRunning("[]")).toBe(false);
    expect(parseCodexRunning("null")).toBe(false);
  });
});

describe("launch argument construction", () => {
  test("builds the debug port flag", () => {
    expect(debugPortArg(9333)).toBe("--remote-debugging-port=9333");
  });
  test("single-quotes the exe path and escapes embedded quotes", () => {
    const script = startProcessScript("C:\\app\\ChatGPT.exe", 9333);
    expect(script).toContain("Start-Process");
    expect(script).toContain("'C:\\app\\ChatGPT.exe'");
    expect(script).toContain("--remote-debugging-port=9333");
  });
});

test("installed mode clears dev profile overrides", () => {
  const env = installedCodexEnvironment({ HOME: "C:\\h", CODEX_ELECTRON_USER_DATA_PATH: "C:\\dev", EXPLODEX_USER_DATA: "C:\\dev" });
  expect(env).toEqual({ HOME: "C:\\h" });
});
