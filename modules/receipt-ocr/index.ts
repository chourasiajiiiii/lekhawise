import { requireOptionalNativeModule } from 'expo-modules-core';

import type { TextPiece } from '../../src/features/expenses/textRows';

type ReceiptOcrModule = { recognizeText(uri: string): Promise<TextPiece[]> };

/** The native module, or null where it is not built in (Expo Go, web, tests). */
export const ReceiptOcr = requireOptionalNativeModule<ReceiptOcrModule>('ReceiptOcr');
