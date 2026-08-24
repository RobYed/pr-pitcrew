# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.1] - 2026-08-24

### Fixed

- A repository variable containing a dollar sign reached the agent mangled. The
  prompt's placeholders were substituted with `String.replace` and a string
  argument, which expands `$&`, `` $` ``, `$'`, `$$` and `$1`-`$9` in the
  replacement - so a `PITCREW_TARGET_URL` or a path with a dollar sign in it
  arrived as a different, plausible-looking value.

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

[Unreleased]: https://github.com/RobYed/pr-pitcrew/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/RobYed/pr-pitcrew/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/RobYed/pr-pitcrew/releases/tag/v1.0.0
