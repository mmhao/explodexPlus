import { fileURLToPath } from "node:url";

// Platform dispatcher for the launcher (the .app / .lnk the user double-clicks).
// macOS builds an Explodex.app bundle; Windows drops a Start-Menu/Desktop .lnk
// that shells out to a small .cmd wrapper. Callers pass the same options.
export async function installLauncher(options = {}) {
  if (process.platform === "win32") {
    const { installLauncher: win } = await import("./launcher-windows.mjs");
    const cliScript = options.cliScript ?? fileURLToPath(new URL("../bin/explodex.mjs", import.meta.url));
    return win({ ...options, cliScript });
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
