# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- A pull request opened or pushed by a GitHub App bot is reviewed again. Every
  run went through `opencode github run`, which refuses to start unless the
  triggering actor has write access - and GitHub's collaborator API answers
  `none` for every bot account, because a bot is not a collaborator. Pull
  requests from `cursor[bot]`, `github-actions[bot]` and their kind therefore
  ended with `permission: none` and a red check before the model saw the diff.
  A `pull_request` now runs through the OpenCode CLI, where that lookup does not
  happen; the comment triggers keep the action, which is the right door for
  them. What authorises a `pull_request` is unchanged: a fork gets no secrets
  from GitHub and is refused by `assert-same-repo.mjs`, so the head branch lives
  in the repository and somebody with write access pushed it. See
  [ADR 9](docs/adr/0009-the-pull-request-path-runs-the-cli.md), and
  `docs/threat-model.md` for the one thing this gives up and how to add it back.
- A run whose agent step died before OpenCode had a session no longer publishes
  an invented `verdict: pass`. `ensure-report.mjs` asked for the report with
  `opencode run --continue`; with nothing to continue, that opens a *new*
  session whose only instruction is to call `write_report`, and a model with no
  diff in front of it answers "no defects found". The pull request then carried
  a passed quality gate for a review that never ran. The recovery turn now needs
  a session id from `session list` before it spends anything, and a run without
  one is published as what it is: a run that reviewed nothing.

### Changed

- On a `pull_request`, the pull request's title, body and comments no longer
  reach the prompt: the wrapper action assembled those, and nothing on that path
  does now. The agent gets what this package fetched - the diff, and for the
  acceptance test the linked issue. A comment-triggered run is unchanged.
- On a `pull_request`, no comment appears on the pull request until the review
  is published. The action posted a `[Working...]` placeholder and then the
  agent's raw reply, which `publish-report.mjs` rewrote; now it posts its own
  comment, which it already knew how to do.
- The agent that runs is named on the command line (`--agent`) as well as
  through `default_agent`, so agent selection no longer rests on one field the
  runtime is free to ignore.

### Security

- The branch under review configures the runtime on neither path.
  `OPENCODE_DISABLE_PROJECT_CONFIG` is set on every run, so an `opencode.json`,
  an `AGENTS.md` as system instructions or a custom tool under `.opencode/` from
  the head branch is not loaded - that last one being JavaScript imported into
  the process holding the model key, for an agent that otherwise has no shell.
  The agents still *read* your `AGENTS.md`: their prompts send them to it, and
  now the transcript shows it happening. The report tool this package installs
  in `~/.config/opencode/tools/` is unaffected.
- On a `pull_request`, the repository token is no longer in the environment of
  the process that reads the diff. The CLI talks to no GitHub API; everything on
  the pull request is published by the steps after it.
- Session sharing is refused in the generated configuration
  (`"share": "disabled"`) rather than only through an action input the CLI does
  not have.

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
