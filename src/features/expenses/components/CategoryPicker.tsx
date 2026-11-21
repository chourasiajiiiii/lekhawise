import { StyleSheet, View } from 'react-native';

import { useT } from '@/core/i18n/locale';
import { AppText, Chip, type SelectOption } from '@/core/ui';

import type { Category } from '../types';

/**
 * Category chips. Main categories come first; once one with subcategories is chosen, its
 * subcategories appear underneath so the entry can be filed more precisely.
 */
export function CategoryPicker({
  categories,
  value,
  onChange,
}: {
  categories: Category[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  const t = useT();
  const parents = categories.filter((c) => !c.parent_id || !categories.some((p) => p.id === c.parent_id));
  const selected = categories.find((c) => c.id === value);
  const activeParentId = selected?.parent_id && categories.some((p) => p.id === selected.parent_id) ? selected.parent_id : selected?.id;
  const children = categories.filter((c) => c.parent_id === activeParentId);
  const activeParent = categories.find((c) => c.id === activeParentId);

  return (
    <View style={styles.wrap}>
      <View style={styles.chips}>
        {parents.map((c) => (
          <Chip
            key={c.id}
            label={c.name}
            icon={c.icon}
            color={c.color}
            selected={activeParentId === c.id}
            onPress={() => onChange(c.id)}
          />
        ))}
      </View>
      {activeParent && children.length ? (
        <View style={styles.sub}>
          <AppText variant="caption" muted>
            {t('Subcategory of {name}', { name: activeParent.name })}
          </AppText>
          <View style={styles.chips}>
            <Chip label={t('General')} selected={value === activeParent.id} onPress={() => onChange(activeParent.id)} />
            {children.map((c) => (
              <Chip key={c.id} label={c.name} icon={c.icon} color={c.color} selected={value === c.id} onPress={() => onChange(c.id)} />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** Options for a SelectModal: main categories with their subcategories indented under them. */
export function categoryOptions(categories: Category[]): SelectOption[] {
  return categories.map((c) => ({
    value: c.id,
    label: c.name,
    icon: c.icon,
    color: c.color,
    indent: !!c.parent_id,
  }));
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sub: { gap: 8, paddingLeft: 8 },
});
