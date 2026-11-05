# Brainstorm

A local Electron app for iterating on UI designs with an agent. An agent in a T3 Code thread builds a design as switchable, adjustable blocks through the `brainstorm` CLI. Rob adjusts controls, pins feedback and asks for a regenerate, and the request goes back to the thread.

- `docs/brief.md` is the product spec.
- `docs/design.md` is the contract the code builds against.

## Develop

Node 22.18 or later.

```
npm install
npm run build      # esbuild and Vite build dist/
npm test           # vitest
npm run typecheck
npm run verify:1   # the built CLI and headless server against a fake T3
```

`npm install` builds `dist/` and exposes the `brainstorm` command (`npm link` puts it on PATH). Run `brainstorm --help` for the commands.
