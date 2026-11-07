# Brainstorm

A local Electron app for iterating on UI designs with an agent. An agent in a T3 Code thread builds a design as switchable, adjustable blocks through the `brainstorm` CLI. Rob adjusts controls, pins feedback and asks for a regenerate, and the request goes back to the thread.

- `docs/brief.md` is the product spec.
- `docs/design.md` is the contract the code builds against.

## Install

Download the installer for your OS from the [releases](https://github.com/RobertScholey98/brainstorm/releases). Each one installs the app and puts the `brainstorm` command on PATH; it runs on the app's own Electron, so no Node is needed. The builds are unsigned for now.

| OS | File | `brainstorm` on PATH | First run |
|---|---|---|---|
| Windows | `Brainstorm-<v>-win-x64.exe` | the installer adds the app's `resources\bin` to your user PATH; open a new terminal | SmartScreen: More info, then Run anyway |
| macOS | `Brainstorm-<v>-mac-arm64.pkg` (Apple Silicon) or `-mac-x64.pkg` | the installer links `/usr/local/bin/brainstorm` | right-click the .pkg, then Open |
| Linux | `Brainstorm-<v>-linux-amd64.deb` | the package links `/usr/bin/brainstorm` | `sudo apt install ./Brainstorm-<v>-linux-amd64.deb` |
| Linux | `Brainstorm-<v>-linux-x64.tar.gz` | link it yourself: `ln -s "$PWD/Brainstorm-<v>-linux-x64/resources/bin/brainstorm" ~/.local/bin/` | |

After that, the Windows app and the .deb update themselves: they check GitHub for a newer published release 15 seconds after start and every 30 minutes, download it in the background, and show **Restart to update** at the foot of the sidebar. Quitting installs a downloaded update too. The macOS build and the tar.gz can't update themselves yet (the Mac build isn't signed), so download those again from the releases page. `BRAINSTORM_DISABLE_AUTO_UPDATE=1` turns updating off.

The app ships the agent skill, `/use-brainstorm`, and copies it to `~/.claude/skills/use-brainstorm` each time it starts, so an update brings the matching skill. A copy you changed is moved to `~/.claude/skill-backups` first. The Windows installer opens the app when it finishes; on macOS and Linux, open Brainstorm once after installing. From a checkout, `node scripts/install-skill.mjs` does the same.

## Release

`.github/workflows/build.yml` builds, tests and packages on Windows, macOS and Linux for every push to `main` and every pull request; the installers are attached to the run.

To release, open **Actions → Build → Run workflow** on `main` and pick patch, minor or major (or run `gh workflow run build.yml -f bump=patch`). The workflow bumps the latest `vX.Y.Z` tag, builds every installer at that version, then pushes the tag and drafts a GitHub release with them attached; publish it from the Releases page. Installed apps only see a release once it's published, through the `latest.yml` and `latest-linux.yml` feed files attached beside the installers. The first release takes `package.json`'s version. Nobody edits a version by hand, and a failed build leaves no tag. `npm run dist` builds the current OS's installer into `release/`. Signing switches on when the secrets listed at the top of the workflow exist.

## Develop

Node 22.18 or later.

```
npm install
npm run build      # esbuild and Vite build dist/
npm test           # vitest
npm run typecheck
npm run lint:design # renderer classes stay on the closed scales and colour tokens
npm run verify:1   # the built CLI and headless server against a fake T3
npm run verify:2   # the Electron app: sandboxed canvas and variant switching
npm run verify:3   # the Electron app: controls, overrides, restart and regenerate
npm run verify:update # Windows: installs a build, updates it from a local feed through Restart to update, uninstalls
```

`node scripts/seed-demo.mjs` opens the app on a temp home with a demo session, the cyberpunk chore roulette, committed through the real CLI against a fake T3 thread.

`npm install` builds `dist/` and exposes the `brainstorm` command (`npm link` puts it on PATH). Run `brainstorm --help` for the commands.
