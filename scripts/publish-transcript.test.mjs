import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isRefusal } from './publish-transcript.mjs';

describe('a refused tool call in the transcript', () => {
  it('is told apart from a tool that broke', () => {
    // The reader's first question about a red line is which of the two it is.
    for (const message of [
      'The user rejected this tool call',
      'permission denied',
      'This command is not allowed by the current permissions',
      'bash is not permitted for this agent',
      'denied by the permission profile',
    ]) {
      assert.equal(isRefusal(message), true, message);
    }
  });

  it('leaves an ordinary failure alone', () => {
    for (const message of [
      'connect ECONNREFUSED 127.0.0.1:4000',
      'The connection was refused by the server',
      'ENOENT: no such file or directory',
      'Timed out after 30000ms',
      '',
      undefined,
    ]) {
      assert.equal(isRefusal(message), false, String(message));
    }
  });
});
