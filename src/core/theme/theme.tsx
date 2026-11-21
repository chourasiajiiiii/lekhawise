import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider, type Theme } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { createContext, type ReactNode, useContext, useEffect, useMemo } from 'react';
import { useColorScheme } from 'react-native';

import { useSetting } from '../settings/settings';

export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_SETTING_KEY = 'theme';

const light = {
  background: '#F5F6FA',
  surface: '#FFFFFF',
  surfaceAlt: '#EEF0F5',
  text: '#14161F',
  textMuted: '#646B7D',
  border: '#E1E4EC',
  primary: '#4F46E5',
  primaryText: '#FFFFFF',
  primarySoft: '#E8E7FD',
  expense: '#DC2626',
  income: '#16A34A',
  warning: '#D97706',
  danger: '#DC2626',
  overlay: 'rgba(0,0,0,0.45)',
};

const dark: typeof light = {
  background: '#0E1016',
  surface: '#181B24',
  surfaceAlt: '#222633',
  text: '#F2F3F7',
  textMuted: '#9AA1B2',
  border: '#2A2F3D',
  primary: '#818CF8',
  primaryText: '#0E1016',
  primarySoft: '#262A4A',
  expense: '#F87171',
  income: '#4ADE80',
  warning: '#FBBF24',
  danger: '#F87171',
  overlay: 'rgba(0,0,0,0.6)',
};

export type Colors = typeof light;

type ThemeValue = { colors: Colors; isDark: boolean };

const ThemeContext = createContext<ThemeValue>({ colors: light, isDark: false });

export function useTheme(): ThemeValue {
  return useContext(ThemeContext);
}

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [preference] = useSetting<ThemePreference>(THEME_SETTING_KEY, 'system');
  const isDark = preference === 'system' ? system === 'dark' : preference === 'dark';
  const colors = isDark ? dark : light;

  const navigationTheme = useMemo<Theme>(() => {
    const base = isDark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: colors.primary,
        background: colors.background,
        card: colors.surface,
        text: colors.text,
        border: colors.border,
      },
    };
  }, [isDark, colors]);

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(colors.background).catch(() => {});
  }, [colors.background]);

  const value = useMemo(() => ({ colors, isDark }), [colors, isDark]);

  return (
    <ThemeContext.Provider value={value}>
      <NavigationThemeProvider value={navigationTheme}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        {children}
      </NavigationThemeProvider>
    </ThemeContext.Provider>
  );
}

/** Colours that read well on both light and dark backgrounds, for categories and accounts. */
export const PALETTE = [
  '#EF4444',
  '#F97316',
  '#F59E0B',
  '#84CC16',
  '#22C55E',
  '#14B8A6',
  '#06B6D4',
  '#3B82F6',
  '#6366F1',
  '#8B5CF6',
  '#EC4899',
  '#64748B',
] as const;

/** Spoken names for the palette, so screen readers do not read out hex codes. */
export const PALETTE_NAMES: Record<string, string> = {
  '#EF4444': 'Red',
  '#F97316': 'Orange',
  '#F59E0B': 'Amber',
  '#84CC16': 'Lime',
  '#22C55E': 'Green',
  '#14B8A6': 'Teal',
  '#06B6D4': 'Cyan',
  '#3B82F6': 'Blue',
  '#6366F1': 'Indigo',
  '#8B5CF6': 'Violet',
  '#EC4899': 'Pink',
  '#64748B': 'Slate',
};
