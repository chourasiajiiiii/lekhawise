#!/usr/bin/env node
/**
 * Tiny Android device driver for manual and scripted end-to-end checks. No dependencies: it uses adb and
 * UI Automator, which ship with the Android SDK.
 *
 * Usage: node e2e/android/driver.mjs <step> [<step> ...]
 *
 * Steps (run in order, stop at the first failure):
 *   tap:<text>            tap the element whose text or accessibility label equals <text>
 *   tap:/<regex>/         ... or matches a regular expression
 *   tap:<text>#<n>        tap the n-th match (0-based)
 *   tapxy:<x>,<y>         tap a screen coordinate
 *   type:<text>           type into the focused field
 *   clear                 clear the focused field
 *   wait:<text>|/<re>/    wait until visible (10 s)
 *   gone:<text>|/<re>/    wait until no longer visible (10 s)
 *   scroll:<text>         swipe up until visible
 *   swipe:up|down         one swipe
 *   back                  Android back button
 *   key:<KEYCODE>         any key event, e.g. key:ENTER
 *   shot:<name>           save a screenshot to e2e/android/screenshots/<name>.png
 *   texts                 print every visible text and label
 *   pause:<ms>            wait a fixed time
 *
 * Environment: ANDROID_HOME (default D:\Android\sdk), E2E_SERIAL (optional device serial).
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sdk = process.env.ANDROID_HOME || 'D:\\Android\\sdk';
const adbPath = join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const serialArgs = process.env.E2E_SERIAL ? ['-s', process.env.E2E_SERIAL] : [];
const shotsDir = join(here, 'screenshots');

function adb(args, { binary = false } = {}) {
  const result = spawnSync(adbPath, [...serialArgs, ...args], {
    encoding: binary ? 'buffer' : 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`adb ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const decode = (s) =>
  s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#10;/g, '\n').replace(/&amp;/g, '&');

/** Reads the current screen as a flat list of nodes with text, label and bounds. */
function dump() {
  let xml = '';
  for (let attempt = 0; attempt < 3 && !xml.includes('<hierarchy'); attempt++) {
    xml = adb(['exec-out', 'uiautomator', 'dump', '/dev/tty']);
  }
  const nodes = [];
  for (const match of xml.matchAll(/<node ([^>]*?)\/?>/g)) {
    const attrs = Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], decode(m[2])]));
    const b = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(attrs.bounds ?? '');
    if (!b) continue;
    const [x1, y1, x2, y2] = b.slice(1).map(Number);
    if (x2 <= x1 || y2 <= y1) continue;
    nodes.push({
      text: attrs.text ?? '',
      desc: attrs['content-desc'] ?? '',
      cls: attrs.class ?? '',
      x: Math.round((x1 + x2) / 2),
      y: Math.round((y1 + y2) / 2),
      bounds: [x1, y1, x2, y2],
    });
  }
  return nodes;
}

function parseMatcher(spec) {
  let index = 0;
  const hash = spec.lastIndexOf('#');
  if (hash > 0 && /^\d+$/.test(spec.slice(hash + 1))) {
    index = Number(spec.slice(hash + 1));
    spec = spec.slice(0, hash);
  }
  const re = /^\/(.*)\/([a-z]*)$/.exec(spec);
  const test = re ? (s) => new RegExp(re[1], re[2]).test(s) : (s) => s === spec;
  return { test, index, label: spec };
}

function findAll(matcher) {
  return dump().filter((n) => (n.text && matcher.test(n.text)) || (n.desc && matcher.test(n.desc)));
}

async function waitFor(spec, timeout = 10_000) {
  const matcher = parseMatcher(spec);
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const found = findAll(matcher);
    if (found.length > matcher.index) return found[matcher.index];
    await sleep(400);
  }
  throw new Error(`Not found on screen: ${spec}\nVisible: ${visible().join(' | ')}`);
}

function visible() {
  return dump()
    .map((n) => n.text || (n.desc ? `[${n.desc}]` : ''))
    .filter(Boolean);
}

function typeText(text) {
  // `input text` needs spaces as %s and shell metacharacters escaped.
  const escaped = text.replace(/([\\"'`$&|;<>()!*?#~])/g, '\\$1').replace(/ /g, '%s');
  adb(['shell', 'input', 'text', escaped]);
}

const steps = {
  async tap(arg) {
    const node = await waitFor(arg);
    adb(['shell', 'input', 'tap', String(node.x), String(node.y)]);
    await sleep(600);
  },
  async tapxy(arg) {
    const [x, y] = arg.split(',');
    adb(['shell', 'input', 'tap', x, y]);
    await sleep(600);
  },
  async type(arg) {
    typeText(arg);
    await sleep(400);
  },
  async clear() {
    adb(['shell', 'input', 'keycombination', '113', '29']); // Ctrl+A
    adb(['shell', 'input', 'keyevent', '67']); // Delete
    await sleep(300);
  },
  async wait(arg) {
    await waitFor(arg);
  },
  async gone(arg) {
    const matcher = parseMatcher(arg);
    const end = Date.now() + 10_000;
    while (Date.now() < end) {
      if (findAll(matcher).length === 0) return;
      await sleep(400);
    }
    throw new Error(`Still on screen: ${arg}`);
  },
  async scroll(arg) {
    const matcher = parseMatcher(arg);
    for (let i = 0; i < 12; i++) {
      if (findAll(matcher).length > matcher.index) return;
      adb(['shell', 'input', 'swipe', '540', '1700', '540', '900', '300']);
      await sleep(500);
    }
    throw new Error(`Could not scroll to: ${arg}`);
  },
  async swipe(arg) {
    const [from, to] = arg === 'down' ? ['900', '1700'] : ['1700', '900'];
    adb(['shell', 'input', 'swipe', '540', from, '540', to, '300']);
    await sleep(500);
  },
  async back() {
    adb(['shell', 'input', 'keyevent', '4']);
    await sleep(700);
  },
  async key(arg) {
    adb(['shell', 'input', 'keyevent', arg.startsWith('KEYCODE_') ? arg : `KEYCODE_${arg}`]);
    await sleep(400);
  },
  async shot(arg) {
    mkdirSync(shotsDir, { recursive: true });
    await sleep(500);
    const png = adb(['exec-out', 'screencap', '-p'], { binary: true });
    const file = join(shotsDir, `${arg}.png`);
    writeFileSync(file, png);
    console.log(`screenshot: ${file}`);
  },
  async texts() {
    console.log(visible().join(' | '));
  },
  async pause(arg) {
    await sleep(Number(arg));
  },
};

for (const raw of process.argv.slice(2)) {
  const colon = raw.indexOf(':');
  const name = colon === -1 ? raw : raw.slice(0, colon);
  const arg = colon === -1 ? '' : raw.slice(colon + 1);
  const step = steps[name];
  if (!step) {
    console.error(`Unknown step: ${raw}`);
    process.exit(2);
  }
  try {
    await step(arg);
    console.log(`ok   ${raw}`);
  } catch (error) {
    console.error(`FAIL ${raw}\n${error.message}`);
    process.exit(1);
  }
}
