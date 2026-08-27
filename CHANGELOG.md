# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **A review that never opened the files it reported on can no longer look like a thorough pass.**
  The hunk is three lines of context; the questions a security review asks are questions about the
  file. `fetch-diff.mjs` now writes the paths from that same diff, the prompt names them, and the
  comment's scope line says how many were actually opened — `7 of 29 changed files opened` — so a
  shallow run and a thorough one no longer look identical on the pull request. A shortfall gets one
  extra turn to open the missing files. Markdown, lockfiles and deletions are not on the list.
- **A pull request opened or pushed by a bot is reviewed again.** `cursor[bot]`,
  `github-actions[bot]` and their kind used to end with `permission: none` and a
  red check before the model saw the diff. A `pull_request` now runs through the
  OpenCode CLI, which does not ask who the actor is; the comment triggers keep
  the action. Nothing else about who may start a run changed - forks are still
  refused. [ADR 9](docs/adr/0009-the-pull-request-path-runs-the-cli.md) has the
  reasoning, `docs/threat-model.md` the one thing it gives up.
- **A run that reviewed nothing is no longer published as `verdict: pass`.**
  When the agent died before OpenCode had a session, the recovery turn invented
  an empty "no defects found" review. It now needs a session before it spends
  anything, and such a run is published as what it was.

### Added

- `PITCREW_REQUIRE_FULL_COVERAGE`. A measured shortfall that survives the extra turn fails the
  check. `false` keeps the number on the comment and the check green. An unreadable session export
  is a warning and no number, never a silent `N of N`.

### Changed

- On a `pull_request`: the pull request's title, body and comments no longer
  reach the model, and no comment appears on the pull request until the review
  is published. Comment-triggered runs are unchanged.
- The acceptance test no longer starts itself for a pull request whose author is
  not an `OWNER`, `MEMBER` or `COLLABORATOR`. Its two ordinary triggers - a
  review request and `/acceptance` - are unaffected.
- With a GitHub App, **Administration: read** is now only needed if you use the
  comment triggers.

### Security

- **Your branch no longer configures the runtime that reviews it**: no
  `opencode.json`, no `AGENTS.md` as system instructions, no tool under
  `.opencode/` - that last one was JavaScript in the process holding your model
  key. The agents still read your `AGENTS.md`; their prompts send them to it.
- The repository token is no longer in the process that reads the diff, and
  session sharing is refused in the configuration rather than only by an input
  the CLI does not have.

## [1.0.0] - 2026-08-24

First public release.

### Added

- Three agents that run on a pull request: **bug review** and **security
  review**, which read the diff, and an **acceptance test**, which drives the
  deployed application in a browser and records the walk-through on video.
- A reusable workflow per agent (`.github/workflows/<agent>.yml`) and a
  composite action (`actions/agent`). Installation is one workflow file in the
  consumer's repository; no scripts, prompts or configuration are copied.
- Any OpenAI-compatible endpoint. Endpoint, key and model id are required inputs
  with no defaults, so an unconfigured repository stops with an error instead of
  billing somebody.
- Findings published as inline review comments plus a summary comment, with a
  configurable severity threshold (`fail-on`) for failing the check.
- The agent's steps published as a transcript in the run summary.
- Permission profiles read from this package at the pinned ref, never from the
  repository under review. Review agents get no shell; writes are confined to
  the run directory.
- Fork pull requests refused, including comment-triggered runs.
- Optional GitHub App identity, so comments carry your own bot name.
- `scripts/release.mjs`, which cuts a release as a separate commit in which the
  package's self-references are rewritten to the tag, and moves the major tag.
- `docs/threat-model.md` and decision records under `docs/adr/`.

### Names

Every variable and secret starts with `PITCREW_`, and the segment after it says
which family it belongs to:

- `PITCREW_LLM_API_*` configures the model provider, for every agent.
- `PITCREW_ACCEPTANCE_*` configures the acceptance test, and nothing else.
- Anything with neither segment applies to every agent: `PITCREW_FAIL_ON`,
  `PITCREW_OUTPUT_LANGUAGE`.

Two names in this package mean "base URL" and two mean "credentials", pointing
at the model provider and at the application under test respectively, and a
repository running only the two diff reviews should be able to see from a name
that half the table does not concern it. See `docs/adr/0001-the-name.md`.

### Note for anyone migrating from the private bundle this grew out of

The invisible markers under the package's own comments were renamed from
`opencode-review-summary` / `opencode-review-finding` to `pitcrew:summary` /
`pitcrew:finding`. Those markers are functional: they are how a run recognises
the comments of its own earlier runs, both for suppressing a finding that was
already made and for counting the open findings that keep a check red. The new
names are written; **all three old forms are still recognised**, so an upgrade
mid-pull-request neither reposts standing findings nor loses them. The
compatibility shim is covered by tests and there is no plan to remove it.

Version `1.0.0` rather than `0.1.0`: the interface is the one that has been
running in a private repository for weeks, and `@v1` is what the examples and
the documentation reference.

[Unreleased]: https://github.com/RobYed/pr-pitcrew/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/RobYed/pr-pitcrew/releases/tag/v1.0.0
