import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";

// Resolve the running node to its real install path (fnm/nvm multishell dirs
// are ephemeral symlinks; the packaged exe path is stable). Falls back to the
// bare "node" lookup when realpath fails.
function currentNodeExe() {
  try {
    return realpathSync(process.execPath);
  } catch {
    return "node";
  }
}

// Platform dispatcher for the launcher (the .app / .lnk the user double-clicks).
// macOS builds an Explodex.app bundle; Windows drops a Start-Menu/Desktop .lnk
// that shells out to a small .cmd wrapper. Callers pass the same options.
export async function installLauncher(options = {}) {
  if (process.platform === "win32") {
    const { installLauncher: win } = await import("./launcher-windows.mjs");
    const cliScript = options.cliScript ?? fileURLToPath(new URL("../bin/explodex.mjs", import.meta.url));
    const nodeExe = options.nodeExe ?? currentNodeExe();
    return win({ ...options, cliScript, nodeExe });
  }
  const { installLauncher: mac } = await import("./launcher-bundle.mjs");
  return mac(options);
}

export async function uninstallLauncher(options = {}) {
  if (process.platform === "win32") {
    const { uninstallLauncher: win } = await import("./launcher-windows.mjs");
    return win(options);
  }
  const { uninstallLauncher: mac } = await import("./launcher-bundle.mjs");
  return mac(options);
}
