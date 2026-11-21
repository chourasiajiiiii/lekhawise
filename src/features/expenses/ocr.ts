import { ReceiptOcr } from '../../../modules/receipt-ocr';

import { joinRows } from './textRows';

/**
 * On-device text recognition for receipt photos. Nothing leaves the phone.
 *   Android: ML Kit with the model bundled in the app.
 *   iPhone: Apple's Vision framework.
 * Both live in modules/receipt-ocr. Neither exists in Expo Go, so the scan button only shows in installed builds.
 */

export function isOcrAvailable(): boolean {
  return ReceiptOcr !== null;
}

/** The text of the photo, one entry per printed row, top to bottom. */
export async function readTextLines(uri: string): Promise<string[]> {
  if (!ReceiptOcr) throw new Error('Text recognition is not available on this device.');
  return joinRows(await ReceiptOcr.recognizeText(uri));
}
