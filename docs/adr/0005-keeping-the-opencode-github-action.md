# 5. The runtime is invoked through the OpenCode GitHub action, not the CLI

Status: accepted, 2026-08-24. Superseded for the `pull_request` path by
[ADR 9](0009-the-pull-request-path-runs-the-cli.md), 2026-08-27; the comment triggers still run through
the action. Revisit the rest if a fourth agent needs a trigger the action rejects.

## Context

Every run goes through `anomalyco/opencode/github`. Three of that action's properties cost this
package a workaround:

1. **It ignores its own `agent` input.** `github.handler.ts` omits the agent when it prompts the
   session and falls back to the built-in `build` agent, which allows everything. Selecting an agent
   therefore happens through `OPENCODE_CONFIG_CONTENT` and `default_agent`.
2. **It posts the agent's reply as a pull request comment itself**, with no way to switch that off.
   The publish step then has to find that comment and rewrite it, which is where a whole family of
   bugs lived: two reviews sharing a run id, a re-run producing two comments, one job deleting
   another's report.
3. **It rejects `workflow_run`.** It understands `issue_comment`, `pull_request_review_comment`,
   `issues`, `pull_request`, `schedule` and `workflow_dispatch`, and stops on anything else with
   `Unsupported event type`. Ordering the acceptance test after the rest of CI therefore cannot use
   the obvious trigger.

Calling the OpenCode CLI directly would remove all three.

## Decision

Keep the action, for this release.

What calling the CLI would cost is not small: the action assembles the pull request context that
reaches the prompt (title, body, comments), checks that the triggering actor has write access to the
repository, fetches and checks out the head branch, and leaves a reaction on the trigger so a person
can see that their `/review` was received. Rebuilding those is a week of work whose failure modes are
subtle, and two of them are security-relevant.

The workarounds, meanwhile, are all in place, all tested, and all documented with the reason they
exist. The comment-rewriting logic is the only one that is genuinely intricate, and it is the
best-tested code in the package.

## Consequences

- **The permission model depends on `default_agent` continuing to work.** If it ever stops, every run
  becomes the `build` agent, which allows everything - the exact failure this package once shipped
  for months without noticing. `build-config.mjs` refuses to run an agent it cannot find, but it
  cannot detect the runtime silently ignoring it. The mitigation is documentation: the job log prints
  the agent on every stream line, and
  [`docs/how-it-works.md`](../how-it-works.md) says to check it first when a run behaves as though no
  permission applied. A real assertion would be better and does not exist yet.
- **`workflow_run` stays unavailable.** The acceptance test starts on a review request instead, which
  turned out to be the better trigger for its own reasons - it is an explicit human signal rather
  than a consequence of a push.
- **The supply chain includes the installer that action runs.** See
  [`docs/threat-model.md`](../threat-model.md).
- This decision is the one most likely to be reversed. If it is, the boundary is narrow: the action
  is invoked from exactly one step of `actions/agent/action.yml`.
