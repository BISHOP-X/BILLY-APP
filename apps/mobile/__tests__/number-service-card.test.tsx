import { fireEvent, render, screen } from '@testing-library/react-native';
import {
  NumberServiceCard,
  ServiceAvatar,
  serviceBrand,
} from '@/features/numbers/service-card';

test('recognizable brand identities do not change the provider catalog', () => {
  expect(serviceBrand('Google Voice')?.icon).toBe('google');
  expect(serviceBrand('WhatsApp')?.icon).toBe('whatsapp');
  expect(serviceBrand('Example')?.icon).not.toBe('twitter');
  expect(serviceBrand('Unknown service')).toBeNull();
});

test('unknown services have a readable local monogram instead of a broken image', async () => {
  await render(<ServiceAvatar name='New service' />);
  expect(screen.getByText('NS')).toBeTruthy();
});

test('a price card selects an offer, without starting a purchase', async () => {
  const select = jest.fn();
  await render(
    <NumberServiceCard
      name='Example'
      detail='7 days'
      totalMinor={700000}
      onPress={select}
    />,
  );
  const button = screen.getByRole('button', { name: /Example, 7 days/ });
  await fireEvent.press(button);
  expect(select).toHaveBeenCalledTimes(1);
});

test('unavailable offers cannot be selected', async () => {
  const select = jest.fn();
  await render(
    <NumberServiceCard
      name='Example'
      detail='Out of stock'
      totalMinor={700000}
      onPress={select}
      disabled
    />,
  );
  const button = screen.getByRole('button', { name: /Example, Out of stock/ });
  expect(button).toBeDisabled();
  await fireEvent.press(button);
  expect(select).not.toHaveBeenCalled();
});
