import { describe, expect, test } from "bun:test";
import { win32 } from "node:path";
import {
  appxDiscoveryScript,
  parseAppxPackage,
  parsePortOwners,
  portOwnedByCodex,
  parseCodexRunning,
  debugPortArg,
  activationScript,
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
    const owners = [
      {
        pid: 1,
        path: "C:\\Program Files\\WindowsApps\\app\\ChatGPT.exe",
        args: "ChatGPT.exe --remote-debugging-port=9333",
      },
    ];
    expect(portOwnedByCodex(owners, { uiExecutable: "C:\\anything\\app\\ChatGPT.exe" })).toBe(true);
  });

  test("does not attribute a foreign owner to Codex", () => {
    const owners = [{ pid: 9, path: "C:\\tools\\node.exe", args: "node server.js" }];
    expect(portOwnedByCodex(owners, { uiExecutable: "C\\app\\ChatGPT.exe" })).toBe(false);
  });
});

describe("codex running detection", () => {
  test("true only for the ChatGPT UI process", () => {
    expect(parseCodexRunning('["ChatGPT","chrome"]')).toBe(true);
  });
  test("background services and the CLI do not count as running", () => {
    // codex-windows-sandbox-service is a SYSTEM service the user cannot quit;
    // `codex` is the CLI. Neither should wedge the launcher on "Quit Codex".
    expect(parseCodexRunning('{"ProcessName":"codex-windows-sandbox-service"}')).toBe(false);
    expect(parseCodexRunning('["codex"]')).toBe(false);
    expect(parseCodexRunning('["Codex Helper"]')).toBe(false);
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
  test("activates via shell:AppsFolder so the app keeps its MSIX identity", () => {
    const script = activationScript("OpenAI.Codex_2p2nqsd0c76g0!App", 9333);
    expect(script).toContain("Shell.Application");
    expect(script).toContain(
      "ShellExecute('shell:AppsFolder\\OpenAI.Codex_2p2nqsd0c76g0!App', '--remote-debugging-port=9333')",
    );
  });
  test("escapes quotes in the AUMID", () => {
    expect(activationScript("a'b", 9333)).toContain("a''b");
  });
});

describe("AUMID derivation", () => {
  test("parseAppxPackage appends !App to the package family name", () => {
    const json = JSON.stringify({
      PackageName: "OpenAI.Codex",
      PackageFamilyName: "OpenAI.Codex_2p2nqsd0c76g0",
      Version: "1.0",
      InstallLocation: "C:\\pkg\\",
    });
    expect(parseAppxPackage(json).aumid).toBe("OpenAI.Codex_2p2nqsd0c76g0!App");
  });
  test("missing family name yields null aumid", () => {
    const json = JSON.stringify({ PackageName: "OpenAI.Codex", InstallLocation: "C:\\pkg\\" });
    expect(parseAppxPackage(json).aumid).toBeNull();
  });
});

test("installed mode clears dev profile overrides", () => {
  const env = installedCodexEnvironment({
    HOME: "C:\\h",
    CODEX_ELECTRON_USER_DATA_PATH: "C:\\dev",
    EXPLODEX_USER_DATA: "C:\\dev",
  });
  expect(env).toEqual({ HOME: "C:\\h" });
});
