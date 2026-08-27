# 9. A `pull_request` runs the OpenCode CLI; a comment keeps the action

Status: accepted, 2026-08-27. Supersedes [ADR 5](0005-keeping-the-opencode-github-action.md) for the
`pull_request` path, which that record already named as the boundary if the decision were reversed.

## Context

`opencode github run` refuses to start unless the triggering actor has write access to the
repository:

```
Asserting permissions for user cursor[bot]...
  permission: none
User cursor[bot] does not have write permissions
```

GitHub's collaborator permission API answers `none` for **every** GitHub App bot, because a bot is
not a collaborator. So a pull request opened or pushed by `cursor[bot]`, `github-actions[bot]` or any
other app was never reviewed: the job went red before the model saw the diff. Upstream has known
this for months and closed the obvious `use_github_token` bypass as not planned, so a newer runtime
does not fix it while the run goes through that handler.

ADR 5 kept the action *because* it checks that the actor may write. That check is the right door for
a `/review` comment. It is the wrong door for `pull_request`, where this package has already decided
the event is trusted - and where bot-authored pull requests are a normal way those events arrive.

**The check is not the boundary it looks like.** On that path what carries the weight is untouched:

- A fork's pull request gets no secrets from GitHub, and `assert-same-repo.mjs` refuses it as the
  first step of every run. Both remain.
- After that step the head branch lives in this repository, so somebody with write access pushed it.
  The content the agent reads came from a writer whether or not the *actor* is one.
- [`docs/threat-model.md`](../threat-model.md) opens by saying that against an author who can push,
  nothing here is a boundary.

What is genuinely given up is small, and for the two review agents it is not code execution: somebody
with read-only access can open a pull request from an existing branch and spend model budget.

The acceptance agent is the exception, because it has a shell, the model key and the credentials of
the environment under test, and it works from a linked issue it did not choose. Its trust rule was
enforced by that actor check on the one trigger where nobody else was checking - an ordinary
`pull_request`, which is how an orchestrator calls it. `acceptance-test.yml` now states the rule
itself on that branch of its `if:`, with `author_association`; the threat model says what that is
worth and what it is not.

## Decision

**The event decides which door a run takes, never the actor.** `pull_request` goes through the
OpenCode CLI. Everything else - which in practice means the comment triggers - keeps the action.

One path for every actor on `pull_request`, not a bot-shaped carve-out. Branching on the actor would
hand the *less* trusted one the shorter route, which is the first thing a reviewer would ask about,
and it would make bot detection security-relevant. (Then it would have to be
`github.event.sender.type == 'Bot'`, never a `[bot]` name suffix.)

The comment path keeps the action on purpose: the workflow's `if:` has already authorised the
commenter, and the reaction the action leaves on the comment is how a person sees that their
`/review` arrived.

## Consequences

ADR 5 named four things the action does. Each had to be answered rather than discovered in
production:

- **It fetches and checks out the head branch.** Not needed: on `pull_request` the workspace already
  holds `refs/pull/N/merge` from `actions/checkout`. That is the change *as it would land on the base
  branch* rather than the head commit, and that is the more useful thing to review.
- **It assembles pull request context into the prompt** (title, body, comments). Gone on this path.
  The agent gets the diff, and for the acceptance test the linked issue, both as files this package
  fetched. Less untrusted text reaching the model is not a loss, but it is a change in what the agent
  knows - and on the comment path that context is still assembled.
- **The runtime reads configuration from the working directory.** `OPENCODE_DISABLE_PROJECT_CONFIG`
  is now set on **every step that starts the runtime** - both run paths, the recovery turn and the
  transcript read - so the branch under review contributes no `opencode.json`, no `AGENTS.md` as
  system instructions, and - the reason this was worth nailing down - no `.opencode/tool/*.js`, which
  OpenCode imports into its own process: JavaScript in the process holding the model key, for an
  agent that otherwise has no shell. Every step matters because on this path the workspace *is* the
  branch under review, and the recovery turn spends a model call of its own there. The report tool
  this package installs lives in `~/.config/opencode/tools/` and is unaffected. An agent may still
  *read* an `AGENTS.md` in the checkout; it is no longer handed to it as instructions.
- **`share: 'false'`.** The CLI has no such input, so the refusal moved into the generated
  configuration as `"share": "disabled"`, where both paths read it. A transcript of somebody's diff
  has no business at opencode.ai.

Two things get better:

- **The CLI honours `--agent`.** Agent selection no longer depends on `default_agent` alone, which is
  the silent-`build`-agent failure mode ADR 5 lists as its first consequence. `default_agent` stays
  in the configuration, so the fallback is the same agent either way.
- **The repository token is not in the process that reads the diff.** The CLI talks to no GitHub API;
  everything on the pull request is published by the steps after it, from their own environment.

And two costs:

- **The installer is now run by a step in this package**, rather than by the wrapper action, on that
  path. Same installer, same pinned `VERSION`, same paragraph in
  [`docs/threat-model.md`](../threat-model.md) - but it is this package's line now.
- **No comment appears until the review is published.** The action posted a `[Working...]` placeholder
  and then the agent's raw reply; `publish-report.mjs` rewrote it. With nothing to rewrite it posts
  its own comment, which it already knew how to do. The one thing lost with the raw reply is the
  agent's own words on a run that produced no report - that comment now says so plainly, and the
  reply itself is in the run summary's transcript.

Granting the bot write access, switching to `pull_request_target`, or waiting for the runtime to skip
its check under `use_github_token` were not the fix. The second is named in the threat model as the
obvious answer and the dangerous one.
