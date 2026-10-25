import { fireEvent, render, screen } from '@testing-library/react-native';
import {
  NumberServiceCard,
  ServiceAvatar,
  serviceBrand,
} from '@/features/numbers/service-card';
import { BillChoiceCard } from '@/features/bills/components/bill-choice-card';

test('recognizable brand identities do not change the provider catalog', () => {
  expect(serviceBrand('Google Voice')?.icon).toBe('google');
  expect(serviceBrand('WhatsApp')?.icon).toBe('whatsapp');
  expect(serviceBrand('Example')?.icon).not.toBe('twitter');
  expect(serviceBrand('Unknown service')).toBeNull();
});

test('unknown services retain a visible local service symbol instead of a broken image', async () => {
  await render(<ServiceAvatar name='New service' />);
  expect(screen.getByTestId('service-fallback-icon')).toBeTruthy();
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

test('failed provider artwork falls back locally instead of leaving a broken image', async () => {
  await render(<ServiceAvatar name="New service" imageUrl="https://example.test/provider.png"/>);
  // expo-image normalizes even a single source to its native source array.
  expect(screen.getByTestId('service-artwork').props.source).toEqual([{uri:'https://example.test/provider.png'}]);
  await fireEvent(screen.getByTestId('service-artwork'),'error',{nativeEvent:{error:'Synthetic image failure'}});
  expect(screen.getByTestId('service-fallback-icon')).toBeTruthy();
});

test('bill provider choices show their catalog logo and remain normal radio selections', async () => {
  const select=jest.fn();
  await render(<BillChoiceCard label="Provider" artworkName="Provider" imageUrl="https://example.test/bank.png"
    selected={false} onPress={select}/>);
  expect(screen.getByTestId('service-artwork').props.source).toEqual([{uri:'https://example.test/bank.png'}]);
  await fireEvent.press(screen.getByRole('radio',{name:'Provider'}));
  expect(select).toHaveBeenCalledTimes(1);
});
