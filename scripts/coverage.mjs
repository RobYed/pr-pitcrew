/**
 * Whether the agent opened the files the diff said it had to.
 *
 * The evidence already exists: a session export walks every tool call, and a
 * `read` of a path is a file that was opened. Comparing that set to the list
 * `fetch-diff.mjs` wrote is the whole measurement. The number belongs on the
 * pull request because that is where a shallow run and a thorough one used to
 * look identical; the job log was the only place the difference lived, and
 * nobody opens the job log of a green check.
 *
 * An unreadable export is a `::warning::` and an unknown measurement, never a
 * silent `N of N`. Claiming full coverage from a transcript we could not read
 * is how a shallow review would keep looking thorough.
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const UNREAD_LIMIT = 12;

export function posixify(path) {
  return String(path ?? '').split(sep).join('/');
}

/**
 * A path as the repository spells it, so a relative read, an absolute read and
 * a read through a symlink of the same file compare as one.
 *
 * The comparison uses what the runtime recorded (`filePath` on the tool call),
 * not what the prompt asked for. A title the runtime invented for the line is
 * not a path.
 */
export function repoPath(raw, workspace) {
  const text = String(raw ?? '').trim();
  if (!text) return '';

  let root = workspace ? String(workspace) : '';
  if (root) {
    try {
      if (existsSync(root)) root = realpathSync(root);
    } catch {
      /* keep the given workspace */
    }
  }

  const asPath = text.startsWith('file://') ? fileURLToPath(text) : text;
  const absolute = isAbsolute(asPath) ? asPath : resolve(root || '.', asPath);

  let resolved = absolute;
  try {
    if (existsSync(absolute)) resolved = realpathSync(absolute);
  } catch {
    /* keep absolute: the file may not exist in a unit test */
  }

  if (!root) return posixify(asPath.replace(/^\.\/+/, ''));

  const rel = relative(root, resolved);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    if (isAbsolute(asPath)) return '';
    return posixify(asPath.replace(/^\.\/+/, ''));
  }
  return posixify(rel);
}

export function readChangedFiles(file) {
  if (!file || !existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

/**
 * Paths the session actually read. Failed, pending and running calls did not
 * open a file. `grep` and `glob` are searches, not opens: the floor is the
 * `read` tool, which is what "open the file" maps to in this runtime.
 */
export function openedPathsFromSession(session) {
  const paths = [];
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  for (const message of messages) {
    const parts = Array.isArray(message?.parts) ? message.parts : [];
    for (const part of parts) {
      if (part?.type !== 'tool' || part.tool !== 'read') continue;
      const status = part.state?.status;
      if (status === 'error' || status === 'pending' || status === 'running') continue;
      const input = part.state?.input ?? {};
      const value = input.filePath ?? input.path;
      if (typeof value === 'string' && value.trim()) paths.push(value.trim());
    }
  }
  return paths;
}

export function measureCoverage(required, openedRaw, workspace) {
  const listed = [...new Set((required ?? []).map(path => String(path).trim()).filter(Boolean))];
  const openedKeys = new Set(
    (openedRaw ?? []).map(path => repoPath(path, workspace)).filter(Boolean),
  );

  const opened = [];
  const missing = [];
  for (const path of listed) {
    const key = repoPath(path, workspace) || posixify(path);
    if (openedKeys.has(key)) opened.push(path);
    else missing.push(path);
  }

  return { status: 'measured', required: listed, opened, missing };
}

export function unknownCoverage(reason) {
  return { status: 'unknown', reason: String(reason ?? ''), required: [], opened: [], missing: [] };
}

export function coverageCaption(coverage) {
  if (!coverage || coverage.status !== 'measured') return '';
  const total = coverage.required.length;
  if (total === 0) return '';
  const opened = coverage.opened.length;
  return `${opened} of ${total} changed files opened`;
}

export function unreadLine(coverage, { limit = UNREAD_LIMIT } = {}) {
  const missing = coverage?.missing ?? [];
  if (missing.length === 0) return '';
  const shown = missing.slice(0, limit);
  const more = missing.length - shown.length;
  const list = shown.map(path => `\`${path}\``).join(', ');
  return more > 0 ? `**Not opened:** ${list}, and ${more} more.` : `**Not opened:** ${list}.`;
}

export function coverageFailReason(coverage) {
  const caption = coverageCaption(coverage);
  const unread = unreadLine(coverage);
  const head = caption
    ? `This run opened ${caption.replace(' opened', '')}, so the verdict is not evidence that the files were reviewed.`
    : 'This run did not open every changed file, so the verdict is not evidence that the files were reviewed.';
  return unread ? `${head} ${unread}` : head;
}

/**
 * A quality gate that already failed for findings or a missing report keeps
 * that reason. Coverage is the floor underneath those, not a substitute for
 * them: a red check that names a finding is more useful than one that only
 * names unread files.
 */
export function applyCoverageGate(gate, coverage, requireFull) {
  if (!requireFull) return gate;
  if (!coverage || coverage.status !== 'measured') return gate;
  if (coverage.missing.length === 0) return gate;
  if (gate?.failed) return gate;
  return {
    failed: true,
    kind: 'coverage',
    mark: '❌',
    label: 'failed',
    reason: coverageFailReason(coverage),
    standing: gate?.standing ?? [],
  };
}

export function parseCoverageFile(file) {
  if (!file || !existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return unknownCoverage(`${file} is not an object.`);
    return parsed;
  } catch (error) {
    return unknownCoverage(`${file} is not valid JSON: ${error.message}`);
  }
}
