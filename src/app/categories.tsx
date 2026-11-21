import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useQuery } from '@/core/db/useQuery';
import { useT } from '@/core/i18n/locale';
import { AppText, Button, Card, Divider, IconBadge, type IconName, ListRow, Screen, Segmented } from '@/core/ui';
import { listCategories } from '@/features/expenses/repo';
import type { Category, CategoryType } from '@/features/expenses/types';

export default function CategoriesScreen() {
  const t = useT();
  const [type, setType] = useState<CategoryType>('expense');
  const { data: categories = [] } = useQuery((db) => listCategories(db, type, true), [type]);
  const active = categories.filter((c) => c.archived === 0);
  const archived = categories.filter((c) => c.archived === 1);

  return (
    <Screen>
      <Segmented
        options={[
          { value: 'expense', label: t('Expense') },
          { value: 'income', label: t('Income') },
        ]}
        value={type}
        onChange={setType}
      />
      <Button title={t('New category')} icon="add" variant="secondary" onPress={() => router.push(`/category/new?type=${type}`)} />
      <AppText variant="caption" muted>
        {t('Subcategories appear indented under their main category. Reports add them up into the main category.')}
      </AppText>
      <Card style={styles.listCard}>
        {active.map((c, i) => (
          <CategoryItem key={c.id} category={c} divider={i > 0} />
        ))}
      </Card>
      {archived.length ? (
        <>
          <AppText variant="caption" muted>
            {t('Archived (hidden when adding transactions, kept in history)')}
          </AppText>
          <Card style={styles.listCard}>
            {archived.map((c, i) => (
              <CategoryItem key={c.id} category={c} divider={i > 0} />
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

function CategoryItem({ category, divider }: { category: Category; divider: boolean }) {
  return (
    <View style={category.parent_id ? styles.sub : null}>
      {divider ? <Divider /> : null}
      <ListRow
        left={<IconBadge name={category.icon as IconName} color={category.color} size={category.parent_id ? 30 : 36} />}
        title={category.name}
        chevron
        onPress={() => router.push(`/category/${category.id}`)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  listCard: { paddingVertical: 4 },
  sub: { paddingLeft: 28 },
});
