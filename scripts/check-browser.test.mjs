import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { candidates } from './check-browser.mjs';

describe('where the browser preflight looks', () => {
  it('takes a consumer\'s own path and looks nowhere else', () => {
    // The point of naming a path is that it is the answer. Searching past a
    // wrong one would resolve some other driver and hide the mistake.
    const found = candidates({ PLAYWRIGHT_MODULE: '/opt/mine/playwright-core' });
    assert.deepEqual(found, [{ how: 'PLAYWRIGHT_MODULE', path: '/opt/mine/playwright-core' }]);
  });

  it('ignores an empty override rather than treating it as an answer', () => {
    const found = candidates({ PLAYWRIGHT_MODULE: '  ' });
    assert.ok(found.length > 1);
  });

  it('never looks in the workspace, which is the branch under review', () => {
    // `prove()` calls `require()`. A candidate under the workspace would be the
    // reviewed branch's own code running in this job, before the fork refusal
    // in actions/agent has said a word - the one rule this package rests on.
    const found = candidates({ GITHUB_WORKSPACE: '/work' });
    for (const { path } of found) {
      assert.ok(!path.startsWith('/work'), `${path} is inside the workspace`);
    }
  });

  it('asks the image before it asks anything else', () => {
    const how = candidates({ GITHUB_WORKSPACE: '/work' }).map(entry => entry.how);
    assert.equal(how[0], 'a known location');
    assert.ok(how.indexOf('a bounded search') === -1 || how.indexOf('a bounded search') > how.indexOf('the module path'));
  });

  it('prefers playwright-core, which is the package the recorder loads', () => {
    const [first] = candidates({});
    assert.match(first.path, /playwright-core$/);
  });

  it('names every path once', () => {
    const paths = candidates({}).map(entry => entry.path);
    assert.equal(paths.length, new Set(paths).size);
  });

  it('looks in the image location the workflow documents', () => {
    const paths = candidates({}).map(entry => entry.path);
    assert.ok(paths.includes('/ms-playwright-agent/node_modules/playwright-core'));
  });
});
