# Brainstorm

A local Electron app for iterating on UI designs with an agent. An agent in a T3 Code thread builds a design as switchable, adjustable blocks through the `brainstorm` CLI. Rob adjusts controls, pins feedback and asks for a regenerate, and the request goes back to the thread.

- `docs/brief.md` is the product spec.
- `docs/design.md` is the contract the code builds against.

## Develop

Node 22.18 or later.

```
npm install
npm run build      # esbuild bundles into dist/
npm test           # vitest
npm run typecheck
```
