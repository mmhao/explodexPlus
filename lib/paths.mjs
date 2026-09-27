import { access, constants } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
  if (process.platform === "win32") return join(home, "Desktop", `${WINDOWS_LAUNCHER_NAME}.lnk`);
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
