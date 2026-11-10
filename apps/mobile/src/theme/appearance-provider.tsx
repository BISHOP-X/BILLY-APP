import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SystemUI from 'expo-system-ui';
import { createContext, type PropsWithChildren, useContext, useEffect, useRef, useState } from 'react';
import { Platform, useColorScheme } from 'react-native';

import { darkTheme, lightTheme } from './tokens';

export type AppearancePreference = 'system' | 'light' | 'dark';
export const APPEARANCE_STORAGE_KEY = 'billy.appearance.v1';
export const validAppearance = (value: unknown): AppearancePreference =>
  value === 'dark' || value === 'light' ? value : 'system';

const AppearanceContext = createContext<{
  preference: AppearancePreference;
  setPreference: (value: AppearancePreference) => void;
  ready: boolean;
} | null>(null);

function initialPreference(): AppearancePreference {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    try { return validAppearance(window.localStorage.getItem(APPEARANCE_STORAGE_KEY)); } catch { /* Storage may be blocked. */ }
  }
  return 'system';
}

export function AppearanceProvider({ children }: PropsWithChildren) {
  const [preference, updatePreference] = useState(initialPreference);
  const [ready, setReady] = useState(Platform.OS === 'web');
  const changed = useRef(false);
  const system = useColorScheme();
  const dark = preference === 'dark' || (preference === 'system' && system === 'dark');
  const theme = dark ? darkTheme : lightTheme;
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let active = true;
    void AsyncStorage.getItem(APPEARANCE_STORAGE_KEY).then(value => {
      if (active && !changed.current) updatePreference(validAppearance(value));
    }).catch(() => undefined).finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const root = document.documentElement;
      root.dataset.billyTheme = dark ? 'dark' : 'light';
      root.style.colorScheme = dark ? 'dark' : 'light';
      root.style.setProperty('--billy-canvas', theme.colors.canvas);
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.colors.canvas);
    } else {
      void SystemUI.setBackgroundColorAsync(theme.colors.canvas).catch(() => undefined);
    }
  }, [dark, theme]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const sync = (event: StorageEvent) => {
      if (event.key === APPEARANCE_STORAGE_KEY) updatePreference(validAppearance(event.newValue));
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  function setPreference(value: AppearancePreference) {
    changed.current = true;
    updatePreference(value);
    if (Platform.OS === 'web') {
      try { window.localStorage.setItem(APPEARANCE_STORAGE_KEY, value); } catch { /* Keep the in-memory choice. */ }
    } else {
      void AsyncStorage.setItem(APPEARANCE_STORAGE_KEY, value).catch(() => undefined);
    }
  }
  return <AppearanceContext.Provider value={{ preference, setPreference, ready }}>{children}</AppearanceContext.Provider>;
}

export function useAppearance() {
  const context = useContext(AppearanceContext);
  return context ?? { preference: 'system' as const, setPreference: () => undefined, ready: true };
}
