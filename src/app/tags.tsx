import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { useQuery } from '@/core/db/useQuery';
import { tPlural, useT } from '@/core/i18n/locale';
import { PALETTE } from '@/core/theme/theme';
import { AppText, Button, Card, Divider, EmptyState, ListRow, PromptModal, Screen } from '@/core/ui';
import { createTag, deleteTag, listTags, renameTag, type TagWithCount } from '@/features/expenses/repoExtras';

/** Tags group entries across categories: a trip, a wedding, a home renovation. */
export default function TagsScreen() {
  const db = useSQLiteContext();
  const t = useT();
  const { data: tags = [] } = useQuery((db) => listTags(db), []);
  const [editing, setEditing] = useState<TagWithCount | 'new' | null>(null);

  const save = async (name: string) => {
    try {
      if (editing === 'new') await createTag(db, name, PALETTE[(tags.length * 5) % PALETTE.length]);
      else if (editing) await renameTag(db, editing.id, name, editing.color);
      setEditing(null);
    } catch (e) {
      Alert.alert(t('Could not save'), e instanceof Error ? t(e.message) : '');
    }
  };

  const open = (tag: TagWithCount) =>
    Alert.alert(`#${tag.name}`, tPlural(tag.count, 'Used on {count} entry', 'Used on {count} entries'), [
      { text: t('Show entries'), onPress: () => router.push({ pathname: '/explore', params: { tagId: tag.id, title: `#${tag.name}` } }) },
      { text: t('Rename'), onPress: () => setEditing(tag) },
      {
        text: t('Delete'),
        style: 'destructive',
        onPress: () =>
          Alert.alert(t('Delete this tag?'), t('It is removed from every entry. The entries themselves stay.'), [
            { text: t('Cancel'), style: 'cancel' },
            { text: t('Delete'), style: 'destructive', onPress: () => deleteTag(db, tag.id) },
          ]),
      },
      { text: t('Cancel'), style: 'cancel' },
    ]);

  return (
    <Screen>
      <Button title={t('New tag')} icon="add" variant="secondary" onPress={() => setEditing('new')} />
      {tags.length ? (
        <Card style={styles.listCard}>
          {tags.map((tag, i) => (
            <View key={tag.id}>
              {i > 0 ? <Divider /> : null}
              <ListRow
                left={<View style={[styles.dot, { backgroundColor: tag.color }]} />}
                title={`#${tag.name}`}
                subtitle={tPlural(tag.count, '{count} entry', '{count} entries')}
                chevron
                onPress={() => open(tag)}
              />
            </View>
          ))}
        </Card>
      ) : (
        <EmptyState icon="pricetag-outline" title={t('No tags yet')} message={t('Tags group entries across categories, for example a trip or a wedding.')} />
      )}
      <AppText variant="caption" muted>
        {t('Add tags while entering a transaction, or select several transactions and tag them together.')}
      </AppText>
      <PromptModal
        visible={editing !== null}
        title={editing === 'new' ? t('New tag') : t('Rename tag')}
        initialValue={editing && editing !== 'new' ? editing.name : ''}
        placeholder={t('e.g. Goa trip')}
        onSubmit={save}
        onCancel={() => setEditing(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  listCard: { paddingVertical: 4 },
  dot: { width: 14, height: 14, borderRadius: 7, marginHorizontal: 11 },
});
