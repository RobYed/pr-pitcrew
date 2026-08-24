#!/usr/bin/env node
/**
 * Renders what the agent actually did into the run summary, below the report:
 * one line per tool call, its input behind a fold, and the agent's own text as
 * Markdown.
 *
 * The reason it exists is that the review's outcome and the review's *work* are
 * different questions. The comment answers the first one. The second one was
 * only answerable by scrolling the raw job log, where OpenCode prints one line
 * per completed tool call - tool name plus its input as a single line of JSON,
 * no timing, no structure, nothing foldable. Following a review the way one
 * follows a Claude Code session was not possible.
 *
 * It goes into the run summary and nowhere near the pull request. This is a log:
 * useful when a verdict surprises somebody, noise in a comment thread. The
 * summary comment already links the run, so it is one click from the verdict.
 *
 * Two CLI calls, both from the pinned OpenCode version, both read-only:
 *
 *   opencode session list --format json -n 5   -> the run's session id
 *   opencode export <id> > file                -> messages and parts as JSON
 *
 * The redirection is load-bearing; see `exportToFile`.
 *
 * `export` redacts nothing unless asked (`--sanitize` is opt-in), which is what
 * makes a readable transcript possible at all. Tool *outputs* are in there too
 * and are deliberately left out: they are the bulk of a session and the least
 * of what a reader needs to follow it.
 *
 * Nothing here may fail the run. A missing transcript costs a convenience; a
 * red check over a missing convenience costs the trust in the check. Every
 * problem is a `::warning::` and an exit code of 0.
 *
 * Environment: TRANSCRIPT_TITLE, GITHUB_STEP_SUMMARY (Actions sets it),
 * optionally OPENCODE_BIN, SESSION_EXPORT (a JSON file instead of the two CLI
 * calls - for trying this out; it prints and never writes to the run summary,
 * see the bottom of this file), TRANSCRIPT_REDACT.
 */

import { appendFileSync, readFileSync, existsSync, openSync, closeSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const title = process.env.TRANSCRIPT_TITLE ?? 'Pitcrew run';
const exportFile = (process.env.SESSION_EXPORT ?? '').trim();

/**
 * The OpenCode binary the run just used.
 *
 * Its own action puts `$HOME/.opencode/bin` on the PATH of every later step, so
 * the name alone is normally enough. The explicit path is the fallback for the
 * case where that did not happen - a transcript is not worth a lookup failing
 * over the difference.
 */
const installed = join(homedir(), '.opencode', 'bin', 'opencode');
const bin = process.env.OPENCODE_BIN ?? (existsSync(installed) ? installed : 'opencode');

/** Says why there is no transcript and leaves the run green. See the header. */
function giveUp(reason) {
  console.log(`::warning::No transcript of the agent's steps: ${reason}`);
  process.exit(0);
}

/**
 * One icon per kind of step, so a long transcript can be scanned rather than
 * read. Same idea as the colours OpenCode gives these tools in its own log, and
 * the same restraint: each icon means one thing, and a tool nobody has mapped
 * gets the neutral one rather than a wrong one.
 */
const TOOL_ICON = {
  read: '📄',
  write: '✏️',
  edit: '✏️',
  patch: '✏️',
  bash: '▶️',
  grep: '🔍',
  glob: '🔍',
  list: '📁',
  webfetch: '🌐',
  websearch: '🌐',
  task: '🧩',
  todowrite: '🧾',
  todoread: '🧾',
  write_report: '📋',
};

/** GitHub rejects a step summary above 1 MiB; the rest is margin for the frame. */
const SUMMARY_LIMIT = 700_000;

/** A tool input is a means of following along, not a document. */
const INPUT_LIMIT = 1200;

/** The agent's own text is the one thing here nobody else writes down. */
const TEXT_LIMIT = 6000;

/** A prompt carries the whole pull request; the first lines say which task it is. */
const PROMPT_LIMIT = 1500;

function parseJson(raw, what) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // The CLI is not a machine interface by contract - an upgrade notice or a
    // stray line around the JSON is plausible. Cutting the document out by its
    // brackets costs nothing and saves the whole transcript.
    const carved = carve(text);
    if (carved) {
      try {
        return JSON.parse(carved);
      } catch {
        /* falls through to the warning below */
      }
    }
    // With what it got, in the log: the first run of this script failed exactly
    // here, and a warning that only says "not JSON" leaves the next person
    // guessing at whether the output was noisy, empty or cut off. Both ends are
    // shown because those are different failures.
    console.log(
      `::warning::Could not read ${what} as JSON (${text.length} characters). It starts ` +
        `${JSON.stringify(text.slice(0, 200))} and ends ${JSON.stringify(text.slice(-200))}.`,
    );
    return null;
  }
}

/**
 * The first complete JSON document in a string, or '' when there is none.
 *
 * Bracket-counting rather than "from the first brace to the last": a log line
 * after the document would be swallowed by the second and break the parse
 * again. Quotes and escapes are tracked, because a `}` inside a string closes
 * nothing - and tool outputs in a session are full of them.
 */
function carve(text) {
  const start = text.search(/[[{]/);
  if (start < 0) return '';

  const closing = { '{': '}', '[': ']' };
  const stack = [];
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{' || char === '[') stack.push(closing[char]);
    else if (char === '}' || char === ']') {
      if (stack.pop() !== char) return '';
      if (stack.length === 0) return text.slice(start, i + 1);
    }
  }
  return '';
}

function opencode(args, what, stdout) {
  try {
    // Generous buffer for the piped case: a session listing is small, but the
    // default 1 MiB is close enough to be worth not thinking about.
    execFileSync(bin, args, {
      encoding: 'utf8',
      maxBuffer: 512 * 1024 * 1024,
      stdio: ['ignore', stdout ?? 'pipe', 'pipe'],
    });
  } catch (error) {
    giveUp(`\`${bin} ${args.join(' ')}\` failed (${what}): ${error.shortMessage ?? error.message}`);
  }
}

/** The same, capturing stdout - only safe for output known to be small. */
function opencodeOutput(args, what) {
  try {
    return execFileSync(bin, args, {
      encoding: 'utf8',
      maxBuffer: 512 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    giveUp(`\`${bin} ${args.join(' ')}\` failed (${what}): ${error.shortMessage ?? error.message}`);
  }
}

/**
 * The session export, written to a file rather than read from a pipe.
 *
 * This is not a preference. The CLI ends every command with `process.exit()` in
 * a `finally`, and a write to a **pipe** is asynchronous: a multi-megabyte
 * export - which any session with a few file reads in it is - gets cut off
 * mid-document, and what arrives is JSON that ends in the middle of a string.
 * That is what the first run of this script produced. A write to a regular file
 * is synchronous, so the same command through a file descriptor arrives whole.
 *
 * The file goes to the runner's temp directory: it is scratch, it is large, and
 * nothing outside this step reads it.
 */
function exportToFile(sessionID) {
  const target = join(process.env.RUNNER_TEMP || tmpdir(), 'pitcrew-session-export.json');
  const handle = openSync(target, 'w');
  try {
    opencode(['export', sessionID], 'exporting the session', handle);
  } finally {
    closeSync(handle);
  }
  console.log(`Exported session ${sessionID} (${statSync(target).size} bytes).`);
  return readFileSync(target, 'utf8');
}

/**
 * The session this run just held, as `{ info, messages }`.
 *
 * The id is not handed to us: OpenCode prints it into its own step's log and
 * nowhere a later step can read it. So the newest root session of this project
 * is taken instead - on a runner that only ever ran one, which is the whole
 * point of a fresh container per job. `session list` already orders by
 * `time_updated` descending; the sort here is in case a future version stops.
 */
function loadSession() {
  if (exportFile) {
    if (!existsSync(exportFile)) giveUp(`SESSION_EXPORT points at ${exportFile}, which does not exist.`);
    return parseJson(readFileSync(exportFile, 'utf8'), exportFile);
  }

  const listed = opencodeOutput(['session', 'list', '--format', 'json', '-n', '5'], 'listing sessions');
  const sessions = parseJson(listed, 'the session list');
  if (!Array.isArray(sessions) || sessions.length === 0) {
    giveUp('OpenCode left no session behind, so the run ended before the agent was prompted.');
  }

  const newest = [...sessions].sort((a, b) => (b?.updated ?? 0) - (a?.updated ?? 0))[0];
  if (!newest?.id) giveUp('the session list carries no id.');

  return parseJson(exportToFile(newest.id), `the export of ${newest.id}`);
}

/**
 * Values that must not appear in a run summary.
 *
 * GitHub masks registered secrets in the *log*; a step summary is a rendered
 * Markdown page and is not masked. That matters here because a tool input is
 * the agent's own text: a shell command or a script it wrote may quote a
 * credential it was given, and the acceptance workflow puts two of those into
 * `GITHUB_ENV`, where every later step - this one included - inherits them.
 *
 * So every value this step can see under a name that sounds like a secret is
 * replaced. Longest first, so a value containing another is not left half
 * standing. Short values are skipped: a four-character password would match
 * half the transcript, and blanking that is worse than the leak it prevents.
 *
 * That floor is for the guesswork only. A name in `TRANSCRIPT_REDACT` was
 * written down by somebody who meant it - a short value there is an instruction,
 * not a false positive, and skipping it would ignore the one setting whose whole
 * purpose is to cover what the pattern does not.
 */
function redactor() {
  const names = new Set(
    (process.env.TRANSCRIPT_REDACT ?? '')
      .split(',')
      .map(name => name.trim())
      .filter(Boolean),
  );

  const values = new Set();
  for (const [name, value] of Object.entries(process.env)) {
    if (!value) continue;
    if (names.has(name)) {
      values.add(value);
      continue;
    }
    if (value.length < 8) continue;
    if (/(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(name)) values.add(value);
  }

  const ordered = [...values].sort((a, b) => b.length - a.length);
  return text => ordered.reduce((carry, value) => carry.split(value).join('[redacted]'), text);
}

const clip = (text, limit) => {
  const value = String(text ?? '');
  return value.length <= limit ? value : `${value.slice(0, limit)}\n…`;
};

/** `mm:ss` from the start of the session - the units of "when did it do that". */
function at(time, start) {
  if (!Number.isFinite(time) || !Number.isFinite(start) || time < start) return '';
  const seconds = Math.round((time - start) / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function span(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/** Blank under a second: a duration nobody waited for is noise on the line. */
function took(state) {
  const ms = Number(state?.time?.end) - Number(state?.time?.start);
  return Number.isFinite(ms) && ms >= 1000 ? span(ms) : '';
}

const tokens = value => (value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value));

/**
 * What a tool call was about, in one line.
 *
 * OpenCode writes a human title for most calls (`state.title`) - a relative
 * path, a pattern - and that is the best version of this. The fallback picks the
 * one field of the input that usually says it, so an unmapped or future tool
 * still gets a line worth reading rather than `{}`.
 */
function subject(part) {
  const label = part.state?.title;
  if (typeof label === 'string' && label.trim()) return label.trim();

  const input = part.state?.input ?? {};
  for (const key of ['filePath', 'path', 'pattern', 'command', 'query', 'description', 'url']) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

/** Markdown tables and inline code both break on a pipe or a newline. */
const inline = value => String(value).replace(/\r?\n/g, ' ').replace(/`/g, "'").trim();

/**
 * The agent's headings, pushed below ours.
 *
 * Its text is rendered as Markdown, because that is what it wrote and reading
 * it as source is worse. But an `# Report` in it would outrank the heading of
 * this section and break the page apart, so every heading moves four levels
 * down and keeps its structure without competing.
 */
const demote = text => text.replace(/^(#{1,6})\s+/gm, (_, hashes) => `${'#'.repeat(Math.min(6, hashes.length + 4))} `);

/**
 * A folded block of verbatim text.
 *
 * The fence is as long as it has to be: a prompt carries fenced examples of its
 * own, and three backticks around a body that contains three backticks ends the
 * block in the middle and spills the rest onto the page as Markdown.
 */
function fold(summary, body, language = '') {
  const longest = Math.max(0, ...[...String(body).matchAll(/`+/g)].map(([run]) => run.length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return ['<details>', `<summary>${summary}</summary>`, '', fence + language, body, fence, '', '</details>'].join('\n');
}

/**
 * The transcript as blocks, in the order things happened.
 *
 * Skipped on purpose: tool outputs (the bulk of a session, and a reader
 * following along does not need them), reasoning, and the bookkeeping parts
 * (`step-start`, `snapshot`, `patch`) that describe the machinery rather than
 * the work. `step-finish` is read for its numbers only.
 */
function transcript(session) {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const blocks = [];
  const stats = { calls: 0, cost: 0, input: 0, output: 0, agent: '', model: '', start: NaN, end: NaN };

  for (const message of messages) {
    const info = message?.info ?? {};
    const parts = Array.isArray(message?.parts) ? message.parts : [];
    const created = Number(info.time?.created);
    if (Number.isFinite(created)) {
      if (!Number.isFinite(stats.start)) stats.start = created;
      stats.end = Math.max(Number.isFinite(stats.end) ? stats.end : 0, Number(info.time?.completed) || created);
    }

    if (info.role === 'assistant') {
      stats.agent ||= String(info.agent ?? '');
      stats.model ||= [info.providerID, info.modelID].filter(Boolean).join('/');
      stats.cost += Number(info.cost) || 0;
      stats.input += Number(info.tokens?.input) || 0;
      stats.output += Number(info.tokens?.output) || 0;
    }

    for (const part of parts) {
      const stamp = at(Number(part.time?.start ?? part.state?.time?.start ?? created), stats.start);
      const when = stamp ? `\`${stamp}\` ` : '';

      if (part.type === 'text' && String(part.text ?? '').trim()) {
        // A synthetic part is something the machinery inserted, not something
        // the agent said; an ignored one was dropped from the conversation.
        if (part.synthetic || part.ignored) continue;

        if (info.role === 'user') {
          const stampHtml = stamp ? `<code>${stamp}</code> ` : '';
          blocks.push(fold(`${stampHtml}📨 <b>Task</b>`, clip(part.text.trim(), PROMPT_LIMIT), 'text'));
          continue;
        }
        blocks.push(`${when}💬 **The agent writes**\n\n${demote(clip(part.text.trim(), TEXT_LIMIT))}`);
        continue;
      }

      if (part.type === 'tool') {
        const status = part.state?.status;
        // Pending and running calls are what a cancelled or timed-out run leaves
        // behind. They are shown - "it was in the middle of this" is exactly the
        // thing somebody reads a transcript for - but marked.
        const failed = status === 'error';
        stats.calls += 1;

        const icon = TOOL_ICON[part.tool] ?? '▪️';
        const what = subject(part);
        const duration = took(part.state);
        const head = [
          `${when}${icon} **${part.tool}**`,
          what && `\`${inline(clip(what, 160))}\``,
          failed && '— failed',
          status === 'pending' || status === 'running' ? '— unfinished' : '',
          duration && `· ${duration}`,
        ]
          .filter(Boolean)
          .join(' ');

        const input = part.state?.input ?? {};
        const details = [];
        if (Object.keys(input).length > 0) {
          details.push(fold('Input', clip(JSON.stringify(input, null, 2), INPUT_LIMIT), 'json'));
        }
        // The error, unlike an output, is the point of the line it belongs to.
        if (failed && part.state?.error) {
          details.push(fold('Error', clip(part.state.error, INPUT_LIMIT), 'text'));
        }

        blocks.push([head, ...details].join('\n\n'));
        continue;
      }

      if (part.type === 'retry') {
        blocks.push(`${when}⚠️ **retry ${Number(part.attempt) || ''}** — ${inline(part.error?.name ?? 'the provider failed')}`);
        continue;
      }
    }

    if (info.role === 'assistant' && info.error) {
      blocks.push(`❌ **${inline(info.error.name ?? 'error')}** — ${inline(clip(info.error.data?.message ?? info.error.message ?? '', 400))}`);
    }
  }

  return { blocks, stats };
}

/** The one line above the transcript: whose steps these are, and what they cost. */
function header(stats) {
  const wall = Number.isFinite(stats.start) && Number.isFinite(stats.end) ? span(stats.end - stats.start) : '';
  const facts = [
    stats.agent && `Agent \`${stats.agent}\``,
    stats.model && `Model \`${stats.model}\``,
    `${stats.calls} tool call${stats.calls === 1 ? '' : 's'}`,
    wall,
    stats.input + stats.output > 0 && `${tokens(stats.input)} in / ${tokens(stats.output)} out`,
    // Zero means the endpoint publishes no prices, not that the run was free.
    stats.cost > 0 && `$${stats.cost.toFixed(4)}`,
  ].filter(Boolean);

  return `<sub>${facts.join(' · ')}</sub>`;
}

const session = loadSession();
if (!session) giveUp('the session export could not be read.');

const { blocks, stats } = transcript(session);
if (blocks.length === 0) giveUp('the session holds no steps to show.');

const lines = [`## ${title} — what the agent did`, '', header(stats), ''];
let spent = lines.join('\n').length;
let shown = 0;

for (const block of blocks) {
  if (spent + block.length > SUMMARY_LIMIT) break;
  lines.push(block, '');
  spent += block.length + 2;
  shown += 1;
}

if (shown < blocks.length) {
  // Named rather than trimmed silently: a transcript that stops without saying
  // so reads like a run that stopped there.
  lines.push(
    `<sub>${blocks.length - shown} further step${blocks.length - shown === 1 ? '' : 's'} did not fit into this page. The job log of the OpenCode step has them all.</sub>`,
    '',
  );
}

const markdown = redactor()(lines.join('\n'));

/**
 * The run summary, but only for the run's own transcript.
 *
 * `SESSION_EXPORT` is the try-it-out mode, and it never writes to the summary
 * even when Actions has set `GITHUB_STEP_SUMMARY` - it prints instead. That is
 * not tidiness, it is the fix for a real accident: the acceptance agent tried
 * this script inside its own job, with a made-up export, to prove that it
 * renders what it claims. `GITHUB_STEP_SUMMARY` pointed at *its* step, which
 * runs before the report - so the run's page read: a transcript of three
 * invented tool calls, then the report, then the real transcript. The summary
 * belongs above the history, and a rehearsal belongs in the log.
 */
if (process.env.GITHUB_STEP_SUMMARY && !exportFile) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  console.log(`Wrote ${shown} of ${blocks.length} steps into the run summary.`);
} else {
  console.log(markdown);
}
