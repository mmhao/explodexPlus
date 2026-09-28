import { access, constants } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Windows lets users redirect per-user special folders (Desktop, Start Menu,…)
// via the "User Shell Folders" registry key — a corporate/OneDrive-tidyed
// machine may keep the desktop on another drive (e.g. E:\Desktop). Resolve the
// real location instead of assuming %USERPROFILE%\\Desktop. Returns null when
// unavailable or when `home` is not the current user's home (tests, other
// users): callers then fall back to plain homedir joins.
// Read through PowerShell with UTF-8 console output: reg.exe prints values in
// the OEM codepage (GBK on zh-CN), which mojibakes non-ASCII paths; junctions
// or symlinks along the resolved path are transparent to the shortcut write.
export function resolveUserShellFolder(name, home = homedir()) {
  if (process.platform !== "win32" || home !== homedir()) return null;
  if (!/^[A-Za-z0-9 ]+$/.test(name)) return null; // defensive: known plain keys only
  const script = [
    "$ErrorActionPreference='Stop'",
    "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8",
    `$k=Get-Item 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders'`,
    `$v=$k.GetValue('${name}',$null,'DoNotExpandEnvironmentNames')`,
    `if($v){[Console]::Out.Write([Environment]::ExpandEnvironmentVariables([string]$v))}`,
  ].join("; ");
  try {
    const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8",
      windowsHide: true,
    });
    const folder = out.replace(/^/, "").trim();
    return folder || null;
  } catch {
    return null;
  }
}

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export function getPackageRoot() { return packageRoot; }
export function getPackageJsonPath() { return join(packageRoot, "package.json"); }
export function getSdkPath() { return join(packageRoot, "sdk", "explodex-sdk.js"); }
export function getPluginsDir() { return join(packageRoot, "plugins"); }
export function getInjectorPath() { return join(packageRoot, "lib", "cdp-inject.mjs"); }
export function getUserPluginsDir(home = homedir()) { return join(home, ".explodex", "plugins"); }
export function getLogDir(home = homedir()) { return join(home, ".explodex", "logs"); }
export const WINDOWS_LAUNCHER_NAME = "Codex (Explodex)";
export function getLauncherPath({ home = homedir(), system = false } = {}) {
  if (process.platform === "win32") {
    const desktop = resolveUserShellFolder("Desktop", home) ?? join(home, "Desktop");
    return join(desktop, `${WINDOWS_LAUNCHER_NAME}.lnk`);
  }
  return system ? "/Applications/Explodex.app" : join(home, "Applications", "Explodex.app");
}

export async function pathExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
