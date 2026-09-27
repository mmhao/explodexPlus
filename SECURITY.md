# Security Policy

## Scope

Explodex Plus runs entirely on your machine: it launches the unmodified, signed Codex desktop app with a Chrome DevTools Protocol debug port and injects locally-stored plugins (`~/.explodex/plugins`, bundled plugins) into the renderer. The Codex installation is never modified.

## Known trade-offs (by design)

- **The debug port is a local attack surface.** While a Codex session started by Explodex Plus is running, anything that can reach `127.0.0.1:9333` can control that renderer. The port binds to loopback only; avoid running Explodex Plus sessions on machines with untrusted local processes.
- **Plugins are unsandboxed renderer code.** Enabling a plugin (bundled or your own) means running its JS with full page privileges inside Codex. Install user plugins only from sources you trust.
- **Codex sign-in and data stay in Codex's own profile.** Explodex Plus does not override the Electron user-data directory and stores only its own state (e.g. plugin settings under the `explodex-` global-state keys).

## Reporting a vulnerability

Please report security issues via a **private security advisory** (Security tab of this repository on GitHub → "Report a vulnerability") rather than a public issue. Include your OS, Codex version (visible in the Explodex settings page), and Explodex Plus version (`explodex-plus --version`).

We aim to respond within 7 days. There is no bounty program; fixes ship in regular releases and are credited on request.
