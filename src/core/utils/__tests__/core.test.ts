/**
 * Core building blocks added for the later phases: Excel writer, password encryption, PIN, translations.
 */
import { strFromU8, unzipSync } from 'fflate';

import { createHash } from 'node:crypto';

import { openWithPassword, s2kSha256, sealWithPassword, WrongPasswordError } from '../../crypto/passwordBox';
import { addTranslations, setLocalePrefs, t, tPlural } from '../../i18n/locale';
import { isValidPin, lockoutFor, pinLockoutRemaining, setPin, verifyPin } from '../../lock/pin';
import { buildXlsx, columnName, excelDate } from '../xlsx';

describe('xlsx', () => {
  it('writes a valid workbook with typed cells', () => {
    const bytes = buildXlsx([
      {
        name: 'Transactions',
        columns: [
          { header: 'Date', type: 'date' },
          { header: 'Amount', type: 'money' },
          { header: 'Note', type: 'text' },
        ],
        rows: [['2026-11-21', -12.5, 'Tea & <biscuits>']],
      },
      { name: 'Transactions', columns: [{ header: 'X', type: 'number' }], rows: [[1]] },
    ]);
    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual([
      '[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml',
      'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml',
    ]);
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
    expect(sheet).toContain(`<c r="A2" s="3"><v>${excelDate('2026-11-21')}</v></c>`);
    expect(sheet).toContain('<c r="B2" s="2"><v>-12.5</v></c>');
    expect(sheet).toContain('Tea &amp; &lt;biscuits&gt;');
    // Two sheets with the same name get distinct names.
    expect(strFromU8(files['xl/workbook.xml'])).toContain('name="Transactions 2"');
  });

  it('numbers columns and dates like Excel', () => {
    expect(columnName(0)).toBe('A');
    expect(columnName(25)).toBe('Z');
    expect(columnName(26)).toBe('AA');
    expect(excelDate('1900-03-01')).toBe(61);
    expect(excelDate('2026-11-21')).toBe(46347);
  });
});

describe('password encryption', () => {
  it('derives keys with the RFC 4880 iterated and salted S2K', async () => {
    const salt = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const unit = Buffer.concat([Buffer.from(salt), Buffer.from('pässword'.normalize('NFC'))]);
    const count = 1000;
    const expected = createHash('sha256');
    let left = count;
    while (left > 0) {
      const part = unit.subarray(0, Math.min(unit.length, left));
      expected.update(part);
      left -= part.length;
    }
    expect(Buffer.from(await s2kSha256('pässword', salt, count)).toString('hex')).toBe(expected.digest('hex'));
    // A count smaller than salt + password hashes them once.
    expect(Buffer.from(await s2kSha256('pässword', salt, 3)).toString('hex')).toBe(createHash('sha256').update(unit).digest('hex'));
  });

  it('round-trips and rejects a wrong password or a modified file', async () => {
    const plain = new TextEncoder().encode('{"secret":"₹1,250"}');
    const box = await sealWithPassword(plain, 'correct horse', 64 * 1024);
    expect(box).toMatchObject({ kdf: 'openpgp-s2k-sha256', count: 65536 });
    expect(box.data).not.toContain('secret');
    expect(new TextDecoder().decode(await openWithPassword(box, 'correct horse'))).toBe('{"secret":"₹1,250"}');
    await expect(openWithPassword(box, 'wrong')).rejects.toBeInstanceOf(WrongPasswordError);
    const tampered = { ...box, data: `${box.data.slice(0, 20)}${box.data[20] === 'A' ? 'B' : 'A'}${box.data.slice(21)}` };
    await expect(openWithPassword(tampered, 'correct horse')).rejects.toBeInstanceOf(WrongPasswordError);
  });
});

describe('app PIN', () => {
  it('accepts the right PIN and pauses after five wrong ones', async () => {
    expect(isValidPin('1234')).toBe(true);
    expect(isValidPin('123')).toBe(false);
    expect(isValidPin('12a4')).toBe(false);
    await setPin('2468');
    expect(await verifyPin('2468')).toEqual({ ok: true });
    const now = 1_000_000;
    for (let i = 1; i <= 4; i++) {
      expect(await verifyPin('0000', now)).toEqual({ ok: false, lockedForMs: 0, attemptsLeft: 5 - i });
    }
    expect(await verifyPin('0000', now)).toMatchObject({ ok: false, lockedForMs: 30_000 });
    expect(await verifyPin('2468', now + 1_000)).toMatchObject({ ok: false }); // still paused, even with the right PIN
    expect(pinLockoutRemaining(now + 1_000)).toBe(29_000);
    expect(await verifyPin('2468', now + 31_000)).toEqual({ ok: true });
    expect(lockoutFor(6)).toBe(60_000);
    expect(lockoutFor(50)).toBe(3_600_000);
  });
});

describe('translations', () => {
  afterEach(() => setLocalePrefs({ language: 'en' }));

  it('translates, fills placeholders and falls back to English', () => {
    addTranslations('xx', { 'Hello {name}': 'Hola {name}', '{count} entry': '{count} cosa', '{count} entries': '{count} cosas' });
    setLocalePrefs({ language: 'xx' });
    expect(t('Hello {name}', { name: 'Asha' })).toBe('Hola Asha');
    expect(t('Not translated')).toBe('Not translated');
    expect(tPlural(1, '{count} entry', '{count} entries')).toBe('1 cosa');
    expect(tPlural(3, '{count} entry', '{count} entries')).toBe('3 cosas');
  });
});
