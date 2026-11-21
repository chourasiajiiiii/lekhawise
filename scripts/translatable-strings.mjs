/**
 * Lists every English string the app shows through t(), so translations can be checked for gaps.
 *
 *   node scripts/translatable-strings.mjs            prints the strings, one JSON string per line
 *   node scripts/translatable-strings.mjs --missing hi   prints the ones the Hindi dictionary lacks
 *
 * Collected: t('...') and tPlural(n, '...', '...') calls, `label: '...'` entries of option lists, messages
 * returned or thrown by validation (shown through t(error.message)), and the currency and colour names.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const SRC = join(root, 'src');

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' || name === 'i18n' || name === 'testing' ? [] : walk(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const STRING = String.raw`'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|\`((?:[^\`\\$]|\\.)*)\``;
const patterns = [
  new RegExp(String.raw`\bt\(\s*(?:${STRING})`, 'g'),
  new RegExp(String.raw`\btPlural\([^,]+,\s*(?:${STRING})\s*,\s*(?:${STRING})`, 'g'),
  new RegExp(String.raw`\blabel:\s*(?:${STRING})`, 'g'),
  new RegExp(String.raw`\b(?:name|native):\s*(?:${STRING})`, 'g'),
  new RegExp(String.raw`throw new (?:Error|BackupError)\(\s*(?:${STRING})`, 'g'),
  new RegExp(String.raw`return (?:${STRING});`, 'g'),
  new RegExp(String.raw`fail\(\s*(?:${STRING})`, 'g'),
];

const unescape = (s) => s.replace(/\\(['"`\\])/g, '$1');

export function collectStrings() {
  const found = new Map();
  for (const file of walk(SRC)) {
    const text = readFileSync(file, 'utf8');
    const isOptionsFile = /types\.ts$|settings\.ts$|currencies\.ts$|defaults\.ts$|formats\.tsx$|import\.tsx$|theme\.tsx$/.test(file);
    patterns.forEach((pattern, i) => {
      if ((i === 2 || i === 3) && !isOptionsFile) return; // option lists only
      if (i === 5 && !/repo\w*\.ts$/.test(file)) return; // validation messages
      for (const match of text.matchAll(pattern)) {
        for (const group of match.slice(1)) {
          if (group === undefined) continue;
          const value = unescape(group);
          if (!value.trim() || /^[\w.-]+$/.test(value) && /[_.]/.test(value)) continue; // ids such as cat_food
          if (!found.has(value)) found.set(value, relative(root, file));
        }
      }
    });
  }
  // Palette colour names are values of an object, not label: entries.
  const theme = readFileSync(join(SRC, 'core', 'theme', 'theme.tsx'), 'utf8');
  for (const m of theme.matchAll(/'#[0-9A-Fa-f]{6}':\s*'([^']+)'/g)) found.set(m[1], 'src/core/theme/theme.tsx');
  found.set('Colour', 'src/features/expenses/components/AppearancePicker.tsx');
  // Weekday names on the formats screen.
  for (const day of ['Monday', 'Sunday', 'Saturday']) found.set(day, 'src/app/formats.tsx');
  return found;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const strings = collectStrings();
  const missingIndex = process.argv.indexOf('--missing');
  if (missingIndex >= 0) {
    const lang = process.argv[missingIndex + 1];
    const dictText = readFileSync(join(SRC, 'features', 'expenses', 'i18n', `${lang}.ts`), 'utf8');
    const keys = new Set([...dictText.matchAll(/^\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"):/gm)].map((m) => unescape(m[1] ?? m[2])));
    const missing = [...strings.keys()].filter((s) => !keys.has(s));
    for (const s of missing) console.log(JSON.stringify(s));
    console.error(`${missing.length} of ${strings.size} missing`);
  } else {
    for (const s of strings.keys()) console.log(JSON.stringify(s));
    console.error(`${strings.size} strings`);
  }
}
