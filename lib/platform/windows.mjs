import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { win32 } from "node:path";
const join = win32.join;
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { decideLaunchState } from "../platform.mjs";
import {
  getInjectorPath,
  getLogDir,
  getPluginsDir,
  getSdkPath,
  getUserPluginsDir,
  pathExists,
} from "../paths.mjs";

const execFileAsync = promisify(execFile);
const DEFAULT_PORT = 9333;
const POWERSHELL = "powershell.exe";
// The Store app ships a UI process named ChatGPT (VisualElements DisplayName)
// plus agent/sandbox helpers named Codex; the Electron renderer we inject lives
// under the ChatGPT.exe process tree.
const UI_EXE_NAME = "chatgpt.exe";
const CODEX_NAME_RE = /^(codex|chatgpt)/i;
// Only the UI process counts as "Codex is running": the user can actually quit
// ChatGPT.exe, while `codex-windows-sandbox-service` (a SYSTEM service with no
// tray) and the `codex` CLI share the loose prefix and used to wedge the
// launcher on "Quit Codex first" forever.
const CODEX_UI_NAME_RE = /^chatgpt$/i;

// Run a PowerShell snippet and return trimmed stdout. All shell interaction is
// funnelled here so it can be swapped out in tests.
async function runPowerShell(script, { encoding = "utf8" } = {}) {
  const { stdout } = await execFileAsync(POWERSHELL, ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding,
    windowsHide: true,
  });
  return stdout.trim();
}

function parseJsonLoose(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

// --- Pure helpers (unit-testable, no process spawn) -------------------------

// Shape the Get-AppxPackage probe query. Family name is stable across updates;
// the InstallLocation folder segment carries a version that is not.
export function appxDiscoveryScript(packageFamily = "OpenAI.Codex") {
  return (
    `$p = Get-AppxPackage -Name '${packageFamily}' | Select-Object -First 1; ` +
    `if ($p) { [pscustomobject]@{ PackageName=$p.Name; PackageFamilyName=$p.PackageFamilyName; ` +
    `Version=$p.Version; InstallLocation=$p.InstallLocation } | ConvertTo-Json -Compress } ` +
    `else { Write-Output '{"missing":true}' }`
  );
}

export function parseAppxPackage(text) {
  const data = parseJsonLoose(text);
  if (!data || data.missing || !data.InstallLocation) return null;
  const installLocation = String(data.InstallLocation).replace(/[\\/]+$/, "");
  const packageFamilyName = data.PackageFamilyName ?? null;
  return {
    packageName: data.PackageName ?? "OpenAI.Codex",
    packageFamilyName,
    aumid: packageFamilyName ? `${packageFamilyName}!App` : null,
    version: data.Version ?? null,
    installLocation,
    uiExecutable: join(installLocation, "app", "ChatGPT.exe"),
  };
}

// Script listing PIDs listening on `port` plus the executable path per PID.
export function portOwnerScript(port) {
  return (
    `$conns = Get-NetTCPConnection -LocalPort ${Number(port)} -State Listen -ErrorAction SilentlyContinue; ` +
    `$pids = @($conns | Select-Object -ExpandProperty OwningProcess -Unique); ` +
    `$owners = foreach ($pid_ in $pids) { ` +
    `$proc = Get-CimInstance Win32_Process -Filter "ProcessId=$pid_" -ErrorAction SilentlyContinue; ` +
    `[pscustomobject]@{ pid=$pid_; path=if($proc){$proc.ExecutablePath}else{$null}; args=if($proc){$proc.CommandLine}else{$null} } }; ` +
    `ConvertTo-Json -Compress -InputObject @($owners)`
  );
}

export function parsePortOwners(text) {
  const data = parseJsonLoose(text);
  return asArray(data).filter((entry) => entry && entry.pid != null);
}

export function portOwnedByCodex(owners, { uiExecutable } = {}) {
  const uiBase = uiExecutable ? win32.basename(uiExecutable).toLowerCase() : UI_EXE_NAME;
  return owners.some(({ path, args }) => {
    const hay = `${path ?? ""} ${args ?? ""}`.toLowerCase();
    return hay.includes(uiBase) || CODEX_NAME_RE.test(win32.basename((path ?? "").toLowerCase()));
  });
}

// Script listing running Codex *UI* process names (see CODEX_UI_NAME_RE for
// why the loose family prefix is wrong here — and why `codex` stays excluded:
// that is the CLI's process name).
export function codexRunningScript() {
  return (
    `$procs = Get-Process -ErrorAction SilentlyContinue | ` +
    `Where-Object { $_.ProcessName -match '^chatgpt$' } | ` +
    `Select-Object -ExpandProperty ProcessName; ` +
    `ConvertTo-Json -Compress -InputObject @($procs)`
  );
}

export function parseCodexRunning(text) {
  const entries = asArray(parseJsonLoose(text));
  return entries.some((entry) => {
    const name = typeof entry === "string" ? entry : (entry?.ProcessName ?? entry?.Name);
    return name != null && CODEX_UI_NAME_RE.test(String(name));
  });
}

export function debugPortArg(port) {
  return `--remote-debugging-port=${Number(port)}`;
}

// The packaged ChatGPT.exe refuses to start when launched directly: without
// MSIX package identity it aborts with "该进程没有程序包标识符" and never
// registers CDP targets. Shell.Application.ShellExecute on the shell:AppsFolder
// item activates the app WITH identity and forwards the arguments.
export function activationScript(aumid, port) {
  const id = String(aumid).replace(/'/g, "''");
  const arg = debugPortArg(port).replace(/'/g, "''");
  return `(New-Object -ComObject Shell.Application).ShellExecute('shell:AppsFolder\\${id}', '${arg}')`;
}

// --- State inspection --------------------------------------------------------

export async function discoverCodex() {
  return parseAppxPackage(await runPowerShell(appxDiscoveryScript()));
}

export async function inspectLaunchState(
  port = Number(process.env.EXPLODEX_DEBUG_PORT ?? DEFAULT_PORT),
  { codex = null } = {},
) {
  const resolved = codex ?? (await discoverCodex());
  const owners = parsePortOwners(await runPowerShell(portOwnerScript(port)));
  const runningText = await runPowerShell(codexRunningScript());
  const codexRunning = parseCodexRunning(runningText);
  const portListening = owners.length > 0;
  const ownedByCodex = portListening && portOwnedByCodex(owners, { uiExecutable: resolved?.uiExecutable });
  return {
    state: decideLaunchState({ portListening, portOwnedByCodex: ownedByCodex, codexRunning }),
    port,
    owners,
    codexRunning,
    codex: resolved,
  };
}

export function installedCodexEnvironment(source = process.env) {
  const env = { ...source };
  delete env.CODEX_ELECTRON_USER_DATA_PATH;
  delete env.EXPLODEX_USER_DATA;
  return env;
}

// --- Process running ---------------------------------------------------------

async function runProcess(file, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: "inherit", windowsHide: true, ...options });
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      signal
        ? reject(new Error(`${file} terminated by ${signal}`))
        : code === 0
          ? resolve()
          : reject(new Error(`${file} exited with code ${code}`)),
    );
  });
}

export async function inject(port = DEFAULT_PORT, home = homedir()) {
  const injector = process.env.EXPLODEX_INJECTOR_PATH || getInjectorPath();
  if (!(await pathExists(injector))) {
    throw new Error(
      `Missing injector at ${injector}. Run "bun run build:npm" (dev) or reinstall explodex (installed mode).`,
    );
  }
  await mkdir(getUserPluginsDir(home), { recursive: true });
  await runProcess(process.execPath, [injector], {
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      EXPLODEX_DEBUG_PORT: String(port),
      EXPLODEX_SDK_PATH: getSdkPath(),
      EXPLODEX_BUNDLED_PLUGINS_DIR: getPluginsDir(),
      EXPLODEX_USER_PLUGINS_DIR: getUserPluginsDir(home),
      EXPLODEX_PLUGINS_DIR: "",
    },
  });
}

async function launchCodexProcess(codex, port) {
  if (!codex?.aumid)
    throw new Error("Could not determine the Codex package AUMID from Get-AppxPackage output.");
  await runPowerShell(activationScript(codex.aumid, port));
}

async function waitForDebugPort(port, timeoutMs = 30_000, { codex } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await inspectLaunchState(port, { codex });
    if (state.state === "debug-codex") return;
    if (state.state === "foreign-port") throw new Error(`Port ${port} was claimed by another process`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for Codex debug port ${port}`);
}

function notifyQuitCodex() {
  const title = "Quit Codex first";
  const message =
    "Codex is running without Explodex. Quit Codex completely (including the system tray), then start it again from the Explodex shortcut.";
  return runPowerShell(
    `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('${message.replace(/'/g, "''")}','${title}') | Out-Null`,
  ).catch(() => {});
}

export async function launch({
  port = Number(process.env.EXPLODEX_DEBUG_PORT ?? DEFAULT_PORT),
  home = homedir(),
} = {}) {
  const logDir = getLogDir(home);
  await mkdir(logDir, { recursive: true });
  const launcherLog = join(logDir, "launcher.log");
  const log = async (message) => appendFile(launcherLog, `${new Date().toISOString()} ${message}\n`);

  const codex = await discoverCodex();
  if (!codex)
    throw new Error(
      `Codex isn't installed as a Store package. Install it from the Microsoft Store, then retry. Logs: ${launcherLog}`,
    );

  let info = await inspectLaunchState(port, { codex });
  await log(`state=${info.state} port=${port}`);
  if (info.state === "foreign-port") {
    const owner = info.owners[0];
    throw new Error(
      `Port ${port} is owned by ${owner?.path || owner?.args || `PID ${owner?.pid || "unknown"}`}. Free it or set EXPLODEX_DEBUG_PORT. Logs: ${launcherLog}`,
    );
  }
  if (info.state === "plain-codex") {
    await notifyQuitCodex();
    await log("plain-codex: asked user to quit Codex");
    return { state: "needs-quit", log: launcherLog };
  }
  if (info.state === "stopped") {
    await log(`activating ${codex.aumid} with debug port ${port}`);
    try {
      await launchCodexProcess(codex, port);
    } catch (error) {
      throw new Error(`Could not launch Codex (${error?.message ?? error}). Logs: ${launcherLog}`);
    }
    try {
      await waitForDebugPort(port, 30_000, { codex });
    } catch (error) {
      throw new Error(`${error.message}. See ${launcherLog}`);
    }
  }
  try {
    await inject(port, home);
  } catch (error) {
    throw new Error(`Injection failed: ${error.message}. Logs: ${launcherLog}`);
  }
  return { state: info.state === "stopped" ? "launched" : "injected", log: launcherLog };
}
