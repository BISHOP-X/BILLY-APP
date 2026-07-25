import { fireEvent, render, screen } from '@testing-library/react-native';

import { StatePanel } from '@/components/ui/state-panel';

describe('StatePanel', () => {
  it('exposes dangerous states as alerts with a semantic heading', async () => {
    await render(
      <StatePanel
        message="Your financial records were not changed."
        testID="danger-panel"
        title="We could not load this"
        tone="danger"
      />,
    );

    const alert = screen.getByRole('alert', {
      name: 'We could not load this. Your financial records were not changed.',
    });
    expect(alert).toHaveProp(
      'accessibilityLiveRegion',
      'assertive',
    );
    expect(
      screen.getByRole('header', { name: 'We could not load this' }),
    ).toBeTruthy();
    expect(
      screen.getByText('Your financial records were not changed.'),
    ).toBeTruthy();
  });

  it('provides a labelled, operable recovery action', async () => {
    const onRetry = jest.fn();
    await render(
      <StatePanel
        actionLabel="Try again"
        message="Check your connection and retry."
        onAction={onRetry}
        title="You appear to be offline"
      />,
    );

    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not render a dead action when no handler is supplied', async () => {
    await render(
      <StatePanel
        actionLabel="Try again"
        message="There is no available action."
        title="Unavailable"
      />,
    );

    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});
