#!/usr/bin/env node
/**
 * A browser that records what happens in it. Nothing more.
 *
 * Deliberately ignorant of any particular application: no sign-in, no seeding,
 * no fixtures, no request mocking. Those would be knowledge about one project,
 * and this file is meant to be copied into the next one unchanged. Every click,
 * selector and assertion belongs in the scenario the agent writes.
 *
 * What it does take care of is the part that is easy to get wrong and ruins the
 * proof: a video that never gets flushed because the context stayed open, a
 * failing request nobody noticed because only the screen was watched, and a
 * recording no one can navigate because nothing marks where each criterion
 * begins.
 *
 * Playwright is not installed here. In the official Playwright image the package
 * sits outside the project, so it is resolved through NODE_PATH via `require`,
 * which - unlike `import` - honours that variable. PLAYWRIGHT_MODULE overrides
 * the lookup with an absolute path.
 */

import { createRequire } from 'node:module';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_MODULE, 'playwright-core', 'playwright'].filter(Boolean);
  const failures = [];

  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (error) {
      failures.push(`${candidate}: ${error.message.split('\n')[0]}`);
    }
  }

  throw new Error(
    `Playwright could not be loaded. Tried ${failures.join(' | ')}. ` +
      'Inside the Playwright image set NODE_PATH=/ms-playwright-agent/node_modules, ' +
      'or point PLAYWRIGHT_MODULE at the package.',
  );
}

const timestamp = ms => {
  const total = Math.round(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

/**
 * Opens a recording browser.
 *
 * @param {object} options
 * @param {string} [options.baseUrl]  the app under test, defaults to TARGET_URL
 * @param {object} [options.viewport] defaults to 1280x800
 * @param {string} [options.outDir]   where video, screenshots and logs land, defaults to ARTIFACT_DIR
 * @param {boolean} [options.headless] defaults to true
 */
export async function startRun(options = {}) {
  const { chromium } = loadPlaywright();

  const baseUrl = options.baseUrl ?? process.env.TARGET_URL;
  if (!baseUrl) throw new Error('No base URL: pass `baseUrl` or set TARGET_URL.');

  const viewport = options.viewport ?? { width: 1280, height: 800 };
  const outDir = options.outDir ?? process.env.ARTIFACT_DIR ?? join(process.env.GITHUB_WORKSPACE ?? '.', '.pitcrew-run', 'proof');
  const videoDir = join(outDir, 'video');
  const shotDir = join(outDir, 'screenshots');

  mkdirSync(videoDir, { recursive: true });
  mkdirSync(shotDir, { recursive: true });

  const browser = await chromium.launch({
    headless: options.headless ?? true,
    // The container runs as root, where Chromium's sandbox refuses to start.
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const context = await browser.newContext({
    viewport,
    recordVideo: { dir: videoDir, size: viewport },
    baseURL: baseUrl,
  });

  const startedAt = Date.now();
  const marks = [];
  const consoleLines = [];
  const networkLines = [];
  const pages = [];

  const stamp = () => timestamp(Date.now() - startedAt);

  context.on('page', page => {
    pages.push(page);
    page.on('console', message => {
      consoleLines.push(`[${stamp()}] ${message.type()}: ${message.text()}`);
    });
    page.on('pageerror', error => {
      consoleLines.push(`[${stamp()}] pageerror: ${error.message}`);
    });
  });

  context.on('response', response => {
    const status = response.status();
    // Only what a reviewer would care about; a full HAR of every asset buries it.
    if (status >= 400) {
      networkLines.push(`[${stamp()}] ${status} ${response.request().method()} ${response.url()}`);
    }
  });

  context.on('requestfailed', request => {
    networkLines.push(`[${stamp()}] failed ${request.method()} ${request.url()} (${request.failure()?.errorText})`);
  });

  const page = await context.newPage();

  return {
    browser,
    context,
    page,
    baseUrl,
    outDir,

    /** Stamps the current position in the video. Returns "mm:ss" for the report. */
    mark(label) {
      const at = stamp();
      marks.push({ at, label });
      console.log(`[${at}] ${label}`);
      return at;
    },

    /** Screenshot next to the video. */
    async shot(name, target = page) {
      const file = join(shotDir, `${String(name).replace(/[^a-z0-9_-]+/gi, '-')}.png`);
      await target.screenshot({ path: file, fullPage: true });
      return file;
    },

    /** A line of your own in the console log, for things the browser does not say. */
    note(text) {
      consoleLines.push(`[${stamp()}] note: ${text}`);
    },

    /**
     * Closes everything and writes the artifacts. Must run, including after a
     * failure - Playwright only finishes the video file when the context closes.
     */
    async finish() {
      const videos = pages.map(candidate => candidate.video()).filter(Boolean);

      await context.close();
      await browser.close();

      let video = null;
      for (const [index, handle] of videos.entries()) {
        const path = await handle.path().catch(() => null);
        if (!path) continue;
        const target = join(videoDir, index === 0 ? 'run.webm' : `run-${index + 1}.webm`);
        try {
          renameSync(path, target);
        } catch {
          // Already where it should be, or on another device; the original stays.
          continue;
        }
        video ??= target;
      }

      writeFileSync(join(outDir, 'console.log'), `${consoleLines.join('\n')}\n`);
      writeFileSync(join(outDir, 'network.log'), `${networkLines.join('\n')}\n`);
      writeFileSync(join(outDir, 'marks.json'), `${JSON.stringify(marks, null, 2)}\n`);

      return { video, marks, outDir, consoleLines, networkLines };
    },
  };
}
