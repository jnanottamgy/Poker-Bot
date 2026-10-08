# CLAUDE.md — Johnny's Poker Bot

Read `docs/CONTRACTS.md` (normative APIs and poker/tournament rules) and
`packages/shared-types/src` (the shared vocabulary) before changing any engine.

## Non-negotiables

- **No AI in game logic** (docs/NO_AI.md). No LLM/ML SDKs as dependencies.
- **Never use `Math.random()`** (ESLint enforces). Use `@jpb/randomness`.
- **Server is the authority.** Clients send intentions only.
- **Determinism:** reducers are pure — no `Date.now()`, no mutation of inputs,
  no hidden module-level mutable state. Time arrives via `ctx.now` /
  envelope `at`; randomness via an injected `RandomSource`.
- **State is plain JSON** (no Map/Set/Date/class instances inside state).
- **Chips are integers**, money is integer minor units, and they never mix.
- **Priorities:** correctness > fairness > server authority > reliability >
  scalability > security > UX > visuals.

## Conventions

- TypeScript strict, ESM, `moduleResolution: Bundler`, imports without
  extensions, `import type` for types. Workspace packages are named `@jpb/<dir>`
  and export from `src/index.ts` (no build step; Vite/Vitest/tsx consume TS).
- Tests live in `<package>/test/**/*.test.ts` (Vitest). Cross-package tests live
  in `tests/{property,integration,e2e,chaos,load}`. Use `fast-check` for
  property-based tests.
- No magic numbers in game logic: rules come from config or named constants.
- Small modules, small functions, comments only where they explain *why* or
  document a rule.
- Each package has a `README.md` documenting its algorithms and exact rules.

## Commands

```bash
npx vitest run packages/<name>                      # one package's tests
npx tsc -p packages/<name>/tsconfig.json --noEmit   # typecheck one package (+ what it imports)
npx eslint packages/<name>                          # lint one package
npm run check                                       # everything
```

## Working rules for agents

- Do not run `git commit`, `git push`, `git stash`, `git checkout`, `git reset`
  or anything that rewrites the working tree; the orchestrator commits.
- Do not run `npm install` / add dependencies unless your task explicitly says
  so; all dependencies are pre-installed at the root.
- Only edit the packages/files your task assigns to you. If another package
  appears broken while it is being built concurrently, ignore its errors.
- Do not edit `docs/CONTRACTS.md` unless your task says so; record
  clarifications in your package README under "Contract notes" and report them.
