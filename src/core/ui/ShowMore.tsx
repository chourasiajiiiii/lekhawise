import { type ReactNode, useState } from 'react';

import { useT } from '@/core/i18n/locale';

import { Button } from './controls';

/** How many items a long list shows at first, and how many more each tap adds. */
export const SHOW_MORE_PAGE = 50;

/**
 * For lists that can grow without limit (all entries of a category over a year, a long statement): renders
 * the first page only and a button that adds the next page. Rendering thousands of rows at once inside a
 * scroll view takes seconds on an ordinary phone; a page of 50 renders at once.
 */
export function useShowMore<T>(
  items: readonly T[],
  pageSize = SHOW_MORE_PAGE,
): { visible: readonly T[]; more: ReactNode } {
  const t = useT();
  const [count, setCount] = useState(pageSize);
  const visible = items.length > count ? items.slice(0, count) : items;
  const remaining = items.length - visible.length;
  const more =
    remaining > 0 ? (
      <Button
        title={t('Show {count} more ({total} left)', {
          count: Math.min(pageSize, remaining),
          total: remaining,
        })}
        variant="ghost"
        icon="chevron-down"
        onPress={() => setCount((c) => c + pageSize)}
      />
    ) : null;
  return { visible, more };
}
