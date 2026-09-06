import { fireEvent, render } from '@testing-library/react-native';
import { Platform, Text } from 'react-native';

import { AppScreen } from '@/components/layout/app-screen';

describe('AppScreen mobile web refresh', () => {
  it('refreshes after a deliberate downward pull at the top', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const onRefresh = jest.fn();

    const view = await render(
      <AppScreen onRefresh={onRefresh} testID="refreshable-screen">
        <Text>Dashboard</Text>
      </AppScreen>,
    );

    const scroll = view.getByTestId('refreshable-screen-scroll');
    await fireEvent.scroll(scroll, {
      nativeEvent: { contentOffset: { x: 0, y: 0 } },
    });
    await fireEvent(scroll, 'touchStart', { nativeEvent: { pageY: 100 } });
    await fireEvent(scroll, 'touchMove', { nativeEvent: { pageY: 230 } });
    await fireEvent(scroll, 'touchEnd', { nativeEvent: { pageY: 230 } });

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('does not refresh for a short pull or when scrolled down', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const onRefresh = jest.fn();

    const view = await render(
      <AppScreen onRefresh={onRefresh} testID="refreshable-screen">
        <Text>Dashboard</Text>
      </AppScreen>,
    );

    const scroll = view.getByTestId('refreshable-screen-scroll');
    await fireEvent(scroll, 'touchStart', { nativeEvent: { pageY: 100 } });
    await fireEvent(scroll, 'touchMove', { nativeEvent: { pageY: 150 } });
    await fireEvent(scroll, 'touchEnd', { nativeEvent: { pageY: 150 } });
    await fireEvent.scroll(scroll, {
      nativeEvent: { contentOffset: { x: 0, y: 80 } },
    });
    await fireEvent(scroll, 'touchStart', { nativeEvent: { pageY: 100 } });
    await fireEvent(scroll, 'touchMove', { nativeEvent: { pageY: 250 } });
    await fireEvent(scroll, 'touchEnd', { nativeEvent: { pageY: 250 } });

    expect(onRefresh).not.toHaveBeenCalled();
  });
});
