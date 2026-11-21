import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { hi } from '../i18n/hi';

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('Hindi translation', () => {
  it('covers every string the app shows', () => {
    const script = join(__dirname, '..', '..', '..', '..', 'scripts', 'translatable-strings.mjs');
    const missing = execFileSync(process.execPath, [script, '--missing', 'hi'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    expect(missing.trim()).toBe('');
  });

  it('keeps every {placeholder} of the English text', () => {
    const broken = Object.entries(hi).filter(([en, translated]) => placeholders(en).join() !== placeholders(translated).join());
    expect(broken).toEqual([]);
  });
});
