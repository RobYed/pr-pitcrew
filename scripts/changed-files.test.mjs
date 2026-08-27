/**
 * The files a review has to open, taken from the same diff the agent is handed.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { changedFilesFromDiff, isExemptPath, parseDiffGitLine, unescapeGitPath } from './changed-files.mjs';

const diff = (...files) => files.join('\n');

const file = ({ path, status = 'modified', from } = {}) => {
  const oldPath = from ?? path;
  const lines = [`diff --git a/${oldPath} b/${path}`];
  if (status === 'added') {
    lines.push('new file mode 100644', 'index 0000000..1111111', '--- /dev/null', `+++ b/${path}`);
  } else if (status === 'deleted') {
    lines.push('deleted file mode 100644', 'index 1111111..0000000', `--- a/${path}`, '+++ /dev/null');
  } else if (status === 'renamed') {
    lines.push('similarity index 95%', `rename from ${oldPath}`, `rename to ${path}`, `--- a/${oldPath}`, `+++ b/${path}`);
  } else {
    lines.push('index 1111111..2222222 100644', `--- a/${path}`, `+++ b/${path}`);
  }
  lines.push('@@ -1,3 +1,4 @@', ' context', `+added in ${path}`, ' context');
  return lines.join('\n');
};

describe('isExemptPath', () => {
  it('exempts prose by extension, not by directory', () => {
    assert.equal(isExemptPath('README.md'), true);
    assert.equal(isExemptPath('docs/adr/0001-the-name.md'), true);
    assert.equal(isExemptPath('notes.mdx'), true);
    assert.equal(isExemptPath('notes.MD'), true);
    assert.equal(isExemptPath('notes.txt'), true);
    assert.equal(isExemptPath('src/app.ts'), false);
    assert.equal(isExemptPath('index.html'), false);
    assert.equal(isExemptPath('package.json'), false);
  });

  it('exempts lockfiles by basename wherever they sit', () => {
    assert.equal(isExemptPath('pnpm-lock.yaml'), true);
    assert.equal(isExemptPath('apps/web/pnpm-lock.yaml'), true);
    assert.equal(isExemptPath('package-lock.json'), true);
    assert.equal(isExemptPath('yarn.lock'), true);
    assert.equal(isExemptPath('Cargo.lock'), true);
    assert.equal(isExemptPath('go.sum'), true);
    assert.equal(isExemptPath('lock.ts'), false);
  });
});

describe('unescapeGitPath', () => {
  it('returns an unquoted path as it is', () => {
    assert.equal(unescapeGitPath('src/app.ts'), 'src/app.ts');
  });

  it('unescapes a quoted path with a space', () => {
    assert.equal(unescapeGitPath('"src/foo bar.ts"'), 'src/foo bar.ts');
  });

  it('unescapes a tab and a quote', () => {
    assert.equal(unescapeGitPath('"a\\tb"'), 'a\tb');
    assert.equal(unescapeGitPath('"say \\"hi\\""'), 'say "hi"');
  });
});

describe('parseDiffGitLine', () => {
  it('strips the a/ and b/ prefixes', () => {
    assert.deepEqual(parseDiffGitLine('diff --git a/src/app.ts b/src/app.ts'), {
      oldPath: 'src/app.ts',
      newPath: 'src/app.ts',
    });
  });

  it('reads a rename whose sides differ', () => {
    assert.deepEqual(parseDiffGitLine('diff --git a/old.ts b/new.ts'), {
      oldPath: 'old.ts',
      newPath: 'new.ts',
    });
  });

  it('reads quoted paths with spaces', () => {
    assert.deepEqual(parseDiffGitLine('diff --git "a/foo bar.ts" "b/foo bar.ts"'), {
      oldPath: 'foo bar.ts',
      newPath: 'foo bar.ts',
    });
  });
});

describe('changedFilesFromDiff', () => {
  it('lists a modified source file', () => {
    assert.deepEqual(changedFilesFromDiff(file({ path: 'src/app.ts' })), ['src/app.ts']);
  });

  it('lists a new file, including one in a language nobody special-cased', () => {
    assert.deepEqual(changedFilesFromDiff(file({ path: 'src/onlineStatus.ts', status: 'added' })), [
      'src/onlineStatus.ts',
    ]);
    assert.deepEqual(changedFilesFromDiff(file({ path: 'build.zig', status: 'added' })), ['build.zig']);
  });

  it('does not list a deleted file: there is nothing at HEAD to open', () => {
    assert.deepEqual(changedFilesFromDiff(file({ path: 'src/gone.ts', status: 'deleted' })), []);
    assert.deepEqual(
      changedFilesFromDiff(
        diff(file({ path: 'src/gone.ts', status: 'deleted' }), file({ path: 'src/app.ts' })),
      ),
      ['src/app.ts'],
    );
  });

  it('lists the rename target, not the old name', () => {
    assert.deepEqual(changedFilesFromDiff(file({ path: 'src/new.ts', status: 'renamed', from: 'src/old.ts' })), [
      'src/new.ts',
    ]);
  });

  it('exempts markdown, lockfiles and plain text, and keeps package.json', () => {
    const text = diff(
      file({ path: 'README.md' }),
      file({ path: 'docs/notes.mdx' }),
      file({ path: 'notes.txt' }),
      file({ path: 'pnpm-lock.yaml' }),
      file({ path: 'package.json' }),
      file({ path: 'index.html' }),
    );
    assert.deepEqual(changedFilesFromDiff(text), ['package.json', 'index.html']);
  });

  it('is empty for a markdown-only diff, so nothing is required', () => {
    assert.deepEqual(changedFilesFromDiff(file({ path: 'CHANGELOG.md' })), []);
  });

  it('keeps the order of the diff and drops duplicates', () => {
    const text = diff(file({ path: 'src/b.ts' }), file({ path: 'src/a.ts' }), file({ path: 'src/b.ts' }));
    assert.deepEqual(changedFilesFromDiff(text), ['src/b.ts', 'src/a.ts']);
  });

  it('parses the incremental push it is given, not a pull request it cannot see', () => {
    // fetch-diff.mjs hands over either the before...after comparison or the
    // whole pull request. This function must not invent files that were not in
    // that text: the coverage claim has to match the scope claim next to it.
    assert.deepEqual(changedFilesFromDiff(file({ path: 'src/only-this-push.ts' })), ['src/only-this-push.ts']);
  });

  it('reads a quoted path with a space', () => {
    const text = [
      'diff --git "a/src/foo bar.ts" "b/src/foo bar.ts"',
      'index 1111111..2222222 100644',
      '--- "a/src/foo bar.ts"',
      '+++ "b/src/foo bar.ts"',
      '@@ -1 +1,2 @@',
      ' keep',
      '+added',
    ].join('\n');
    assert.deepEqual(changedFilesFromDiff(text), ['src/foo bar.ts']);
  });
});
