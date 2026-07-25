import { Text } from 'react-native';
import {
  fireEvent,
  renderRouter,
  screen,
} from 'expo-router/testing-library';

import MainTabsLayout from '@/app/(app)/(tabs)/_layout';

const routes = {
  _layout: MainTabsLayout,
  account: () => <Text>Account screen</Text>,
  activity: () => <Text>Activity screen</Text>,
  cards: () => <Text>Cards screen</Text>,
  home: () => <Text>Home screen</Text>,
  services: () => <Text>Services screen</Text>,
};

describe('main tab routes', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('registers and navigates all five customer-facing tabs', async () => {
    await renderRouter(routes, { initialUrl: '/home' });

    expect(screen.getByText('Home screen')).toBeTruthy();
    expect(screen.getByLabelText('Home tab')).toBeTruthy();
    expect(screen.getByLabelText('Activity tab')).toBeTruthy();
    expect(screen.getByLabelText('Cards tab')).toBeTruthy();
    expect(screen.getByLabelText('Services tab')).toBeTruthy();
    expect(screen.getByLabelText('Account tab')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Activity tab'));
    expect(screen.getByText('Activity screen')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Cards tab'));
    expect(screen.getByText('Cards screen')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Services tab'));
    expect(screen.getByText('Services screen')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Account tab'));
    expect(screen.getByText('Account screen')).toBeTruthy();
  });
});
