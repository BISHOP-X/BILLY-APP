import { fireEvent, render, screen } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Text, View } from 'react-native';
import { AppearanceProvider, APPEARANCE_STORAGE_KEY, validAppearance } from '@/theme/appearance-provider';
import { AppearancePicker } from '@/theme/appearance-picker';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { lightTheme, darkTheme } from '@/theme/tokens';
import { TextField } from '@/components/ui/text-field';
import { AuthShell } from '@/components/ui/auth-shell';
import { AdminText, Panel } from '@/features/admin/components';
import { AppButton } from '@/components/ui/button';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
}));
jest.mock('expo-system-ui', () => ({ setBackgroundColorAsync: jest.fn(() => Promise.resolve()) }));

function Preview() {
  const theme = useBillyTheme();
  return <View testID="canvas" style={{ backgroundColor: theme.colors.canvas }}>
    <AppearancePicker />
    <Text testID="ink" style={{ color: theme.colors.text }}>Theme preview</Text>
    <TextField appearance="auth" label="Email address" value="test@example.com" />
    <Panel><AdminText>Operations preview</AdminText></Panel>
    <AppButton label="Cancel & refund" onPress={jest.fn()} variant="refund" />
  </View>;
}

test('saved appearance restores and selecting another theme updates screens and storage', async () => {
  jest.mocked(AsyncStorage.getItem).mockResolvedValueOnce('dark');
  await render(<AppearanceProvider><Preview /></AppearanceProvider>);
  expect(screen.getByTestId('canvas')).toHaveStyle({ backgroundColor: darkTheme.colors.canvas });
  expect(screen.getByText('Email address')).toHaveStyle({ color: darkTheme.colors.text });
  expect(screen.getByText('Operations preview')).toHaveStyle({ color: darkTheme.colors.text });
  await fireEvent.press(screen.getByLabelText('Light appearance'));
  expect(screen.getByTestId('canvas')).toHaveStyle({ backgroundColor: lightTheme.colors.canvas });
  expect(screen.getByText('Email address')).toHaveStyle({ color: lightTheme.colors.text });
  expect(screen.getByText('Operations preview')).toHaveStyle({ color: lightTheme.colors.text });
  expect(AsyncStorage.setItem).toHaveBeenLastCalledWith(APPEARANCE_STORAGE_KEY, 'light');
  expect(screen.getByRole('radio', { name: 'Light appearance', checked: true })).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('System appearance'));
  expect(AsyncStorage.setItem).toHaveBeenLastCalledWith(APPEARANCE_STORAGE_KEY, 'system');
});

test('auth card heading and inputs follow the same appearance', async () => {
  await render(<AppearanceProvider><AuthShell title="Welcome back" subtitle="Sign in securely"><TextField appearance="auth" label="Password" /></AuthShell></AppearanceProvider>);
  await fireEvent.press(screen.getByRole('switch', { name: 'Dark mode' }));
  expect(screen.getByText('Welcome back')).toHaveStyle({ color: darkTheme.colors.text });
  expect(screen.getByText('Password')).toHaveStyle({ color: darkTheme.colors.text });
  await fireEvent.press(screen.getByRole('switch', { name: 'Dark mode' }));
  expect(screen.getByText('Welcome back')).toHaveStyle({ color: lightTheme.colors.text });
});

test('invalid stored values safely fall back to system mode', () => {
  for (const value of [null, undefined, '', 'invalid', 'DARK', {}]) expect(validAppearance(value)).toBe('system');
});

function luminance(hex: string) {
  const c = hex.match(/[a-f\d]{2}/gi)!.map(v => parseInt(v, 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
}
test.each([lightTheme, darkTheme])('body, muted text and placeholders meet readable contrast in dark=$dark', theme => {
  for (const foreground of [theme.colors.text, theme.colors.textMuted, theme.colors.textSoft, theme.colors.warning]) {
    for (const background of [theme.colors.canvas, theme.colors.surface]) {
      const [hi, lo] = [luminance(foreground), luminance(background)].sort((a,b) => b-a);
      expect((hi + 0.05) / (lo + 0.05)).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test.each([lightTheme, darkTheme])('selected action labels remain readable in dark=$dark', theme => {
  const [hi, lo] = [luminance(theme.colors.brand), luminance(theme.colors.onBrand)].sort((a,b) => b-a);
  expect((hi + 0.05) / (lo + 0.05)).toBeGreaterThanOrEqual(4.5);
});
