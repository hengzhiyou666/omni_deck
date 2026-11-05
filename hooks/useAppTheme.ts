import { useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { themes, type AppTheme } from '../constants/theme';
import { useSettingsStore } from '../stores/useSettingsStore';
export function useThemeMode() {
  const mode = useSettingsStore(s => s.themeMode);
  const system = useColorScheme();
  return mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : mode;
}
export function useAppTheme(): AppTheme { return themes[useThemeMode()]; }
export function useThemeStyles<T>(factory: (theme: AppTheme) => T) {
  const theme = useAppTheme();
  const styles = useMemo(() => factory(theme), [factory, theme]);
  return { theme, styles };
}
