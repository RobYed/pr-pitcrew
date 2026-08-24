# 4. No npm dependencies, and manifests in JSON rather than YAML

Status: accepted, 2026-08-24

## Context

A composite action gets no install step. Whatever it needs at run time must already be in the
repository GitHub checked out, or be fetched during a job that holds the model key and the repository
token. Both are worse than not needing anything.

Two places wanted a dependency. The tests were written for Vitest. And an agent manifest reads better
in YAML than in JSON - which would have meant a YAML parser.

## Decision

**Zero runtime and zero development dependencies.**

- Tests run on Node's own test runner: `node --test` from the repository root, `node:assert/strict`
  for assertions. The Vitest suite was ported.
- Manifests and permission profiles are **JSON**. `agents/<id>/agent.json`, not `agent.yml`.
- "Lint" is [`scripts/check-syntax.mjs`](../../scripts/check-syntax.mjs): every `.mjs`, `.js` and
  `.json` file in the repository is parsed without being run. What a linter would catch that the
  tests do not is a syntax error in a file no test imports, and that is exactly what this catches.
- Workflows and actions are linted by **actionlint** in CI, as a container. The shell inside a `run:`
  block is a second language in a YAML file and nothing else here reads it; actionlint parses both,
  and brings shellcheck.
- Node 20.10 is the floor. CI runs 20.10, 22 and 24, because the scripts run in whatever Node the
  consumer's runner image or container happens to have.

## Consequences

- Nothing to install, no lockfile to keep current, no supply chain of our own. The one thing fetched
  at run time is the OpenCode runtime itself, which is discussed in
  [`docs/threat-model.md`](../threat-model.md).
- JSON manifests are slightly less pleasant to write than YAML, and cannot carry comments. A
  `$comment` key is used in the profiles where an explanation earns its place.
- No Prettier, so formatting is by hand and by review. `.editorconfig` states the settings. This is a
  real cost and a small one at this size; if the repository grows contributors, a formatter with a
  vendored binary is the next step rather than an npm dependency.
- `node --test` with a directory argument no longer walks that directory in current Node versions. The
  test command is therefore bare `node --test` from the repository root, and CI runs it that way.
