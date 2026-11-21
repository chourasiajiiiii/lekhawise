import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '../theme/theme';
import { formatDayLabel, type ISODate, parseISODate, toISODate } from '../utils/date';
import { AppText, Icon } from './primitives';

type DateFieldProps = { label?: string; value: ISODate; onChange: (value: ISODate) => void };

/** Date input: native dialog on Android, compact inline picker on iOS. */
export function DateField({ label, value, onChange }: DateFieldProps) {
  const { colors, isDark } = useTheme();
  const date = parseISODate(value);

  return (
    <View style={styles.wrap}>
      {label ? (
        <AppText variant="caption" muted style={styles.label}>
          {label}
        </AppText>
      ) : null}
      {Platform.OS === 'ios' ? (
        <View style={[styles.box, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <AppText>{formatDayLabel(value)}</AppText>
          <DateTimePicker
            value={date}
            mode="date"
            display="compact"
            themeVariant={isDark ? 'dark' : 'light'}
            onChange={(event, selected) => {
              if (event.type === 'set' && selected) onChange(toISODate(selected));
            }}
          />
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            DateTimePickerAndroid.open({
              value: date,
              mode: 'date',
              onChange: (event, selected) => {
                if (event.type === 'set' && selected) onChange(toISODate(selected));
              },
            })
          }
          style={[styles.box, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <AppText>{formatDayLabel(value)}</AppText>
          <Icon name="calendar-outline" color={colors.textMuted} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { paddingHorizontal: 4 },
  box: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
