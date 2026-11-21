import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { useQuery } from '@/core/db/useQuery';
import { useT } from '@/core/i18n/locale';
import { PALETTE } from '@/core/theme/theme';
import { AppText, Button, Chip, IconBadge, type IconName, Screen, SectionTitle, Segmented, TextField } from '@/core/ui';
import { AppearancePicker } from '@/features/expenses/components/AppearancePicker';
import { deleteOrArchiveCategory, getCategory, listCategories, saveCategory, setCategoryArchived } from '@/features/expenses/repo';
import type { Category, CategoryType } from '@/features/expenses/types';

export default function CategoryScreen() {
  const { id, type, parent } = useLocalSearchParams<{ id: string; type?: CategoryType; parent?: string }>();
  const t = useT();
  const isNew = id === 'new';
  const { data, loading } = useQuery(
    async (db) => ({
      category: isNew ? null : await getCategory(db, id),
      all: await listCategories(db, undefined, false),
      childCount: isNew ? 0 : ((await db.getFirstAsync<{ n: number }>('select count(*) as n from categories where parent_id = ?', id))?.n ?? 0),
    }),
    [id],
  );
  if (loading || !data) return <Screen>{null}</Screen>;
  if (!isNew && !data.category) {
    return (
      <Screen>
        <AppText>{t('This category no longer exists.')}</AppText>
      </Screen>
    );
  }
  return (
    <CategoryForm
      key={id}
      existing={data.category}
      defaultType={type ?? 'expense'}
      defaultParent={parent ?? null}
      all={data.all}
      hasChildren={data.childCount > 0}
    />
  );
}

function CategoryForm({
  existing,
  defaultType,
  defaultParent,
  all,
  hasChildren,
}: {
  existing: Category | null;
  defaultType: CategoryType;
  defaultParent: string | null;
  all: Category[];
  hasChildren: boolean;
}) {
  const db = useSQLiteContext();
  const t = useT();
  const [name, setName] = useState(existing?.name ?? '');
  const [type, setType] = useState<CategoryType>(existing?.type ?? defaultType);
  const [icon, setIcon] = useState<IconName>(existing?.icon ?? 'pricetag-outline');
  const [color, setColor] = useState<string>(existing?.color ?? PALETTE[8]);
  const [parentId, setParentId] = useState<string | null>(existing?.parent_id ?? defaultParent);
  const parents = all.filter((c) => c.type === type && !c.parent_id && c.id !== existing?.id);

  const save = async () => {
    if (!name.trim()) {
      Alert.alert(t('Name needed'), t('Give the category a name.'));
      return;
    }
    try {
      await saveCategory(db, existing?.id ?? null, { name: name.trim(), type, icon, color, parent_id: parentId });
      router.back();
    } catch (e) {
      Alert.alert(t('Could not save'), e instanceof Error ? t(e.message) : '');
    }
  };

  const remove = () => {
    if (!existing) return;
    Alert.alert(
      t('Delete category?'),
      t('If transactions use this category it is archived instead: hidden from new entries but kept in history.'),
      [
        { text: t('Cancel'), style: 'cancel' },
        {
          text: t('Delete'),
          style: 'destructive',
          onPress: async () => {
            const result = await deleteOrArchiveCategory(db, existing.id);
            router.back();
            if (result === 'archived') Alert.alert(t('Archived'), t('The category is in use, so it was archived.'));
          },
        },
      ],
    );
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: existing ? t('Edit category') : t('New category') }} />
      <View style={styles.preview}>
        <IconBadge name={icon} color={color} size={64} />
      </View>
      <TextField label={t('Name')} value={name} onChangeText={setName} placeholder={t('e.g. Coffee')} maxLength={40} autoFocus={!existing} />
      {!existing ? (
        <Segmented
          options={[
            { value: 'expense', label: t('Expense') },
            { value: 'income', label: t('Income') },
          ]}
          value={type}
          onChange={(next) => {
            setType(next);
            setParentId(null);
          }}
        />
      ) : null}

      {!hasChildren ? (
        <>
          <SectionTitle>{t('Main category')}</SectionTitle>
          <View style={styles.chips}>
            <Chip label={t('None (this is a main category)')} selected={parentId === null} onPress={() => setParentId(null)} />
            {parents.map((p) => (
              <Chip key={p.id} label={p.name} icon={p.icon} color={p.color} selected={parentId === p.id} onPress={() => setParentId(p.id)} />
            ))}
          </View>
        </>
      ) : (
        <AppText variant="caption" muted>
          {t('This category has subcategories, so it stays a main category.')}
        </AppText>
      )}

      <SectionTitle>{t('Look')}</SectionTitle>
      <AppearancePicker icon={icon} color={color} onIcon={setIcon} onColor={setColor} />
      <View style={styles.actions}>
        <Button title={t('Save')} icon="checkmark" onPress={save} />
        {existing && !existing.parent_id && !existing.archived ? (
          <Button
            title={t('Add subcategory')}
            variant="secondary"
            icon="git-branch-outline"
            onPress={() => router.push(`/category/new?type=${existing.type}&parent=${existing.id}`)}
          />
        ) : null}
        {existing?.archived ? (
          <Button
            title={t('Unarchive')}
            variant="secondary"
            icon="arrow-undo-outline"
            onPress={async () => {
              await setCategoryArchived(db, existing.id, false);
              router.back();
            }}
          />
        ) : existing ? (
          <Button title={t('Delete')} variant="danger" icon="trash-outline" onPress={remove} />
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  preview: { alignItems: 'center', paddingVertical: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actions: { gap: 10, marginTop: 16 },
});
