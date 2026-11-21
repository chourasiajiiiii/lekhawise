import { addTranslations } from '@/core/i18n/locale';

import { hi } from './hi';

/** Registers every translation the app ships with. English is the source text and needs no dictionary. */
export function registerTranslations(): void {
  addTranslations('hi', hi);
}
