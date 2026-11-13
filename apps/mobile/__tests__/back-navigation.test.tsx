import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Keyboard } from 'react-native';
import { AppNavigationTrail, appNavigationTrail, goBackSafely, parentPage } from '@/lib/back-navigation';
import { ScreenHeader } from '@/components/ui/screen-header';

jest.mock('expo-router', () => ({ router: { dismissTo: jest.fn() } }));

test('direct links and refreshes have useful parent destinations', () => {
  for (const [path, expected] of [['/foreign-numbers','/home'], ['/wallet/add-money','/home'], ['/bills/airtime','/bills'], ['/account/profile','/account'], ['/security/transaction-pin','/security'], ['/transaction/test','/activity'], ['/card-order/test','/cards']]) {
    const trail = new AppNavigationTrail();
    trail.record(path, 'owner', true);
    expect(trail.backTarget()).toBe(expected);
    expect(parentPage(path)).toBe(expected);
  }
});
test('back traverses app pages without recording its own return as a new visit', () => {
  const trail = new AppNavigationTrail();
  for (const path of ['/home','/activity','/transaction/test']) trail.record(path,'owner',true);
  expect(trail.backTarget()).toBe('/activity');
  trail.record('/activity','owner',true);
  expect(trail.backTarget()).toBe('/home');
  trail.record('/home','owner',true);
  expect(trail.backTarget()).toBe('/home');
});
test('auth transitions and account changes never retain another session’s navigation', () => {
  const trail = new AppNavigationTrail();
  trail.record('/home','owner',true);
  trail.record('/foreign-numbers','owner',true);
  trail.record('/sign-in',null,false);
  trail.record('/bills/data','other',true);
  expect(trail.backTarget()).toBe('/bills');
  trail.record('/auth/callback?code=secret','other',false);
  trail.record('/foreign-numbers','other',true);
  expect(trail.backTarget()).toBe('/home');
});
test('direct parent fallback does not create a back loop', () => {
  const trail = new AppNavigationTrail();
  trail.record('/security/transaction-pin','owner',true);
  expect(trail.backTarget()).toBe('/security');
  trail.record('/security','owner',true);
  expect(trail.backTarget()).toBe('/account');
  trail.record('/account','owner',true);
  expect(trail.backTarget()).toBe('/home');
});

test('hydration redirect root never becomes a previous page or clears history', () => {
  const trail = new AppNavigationTrail();
  trail.record('/', 'owner', true);
  trail.record('/bills/airtime', 'owner', true);
  trail.record('/', 'owner', false);
  expect(trail.backTarget()).toBe('/bills');
});
test('header preserves explicit modal/form back handlers and dismisses the keyboard', async () => {
  const back = jest.fn(), dismiss = jest.spyOn(Keyboard, 'dismiss');
  await render(<ScreenHeader title="Checkout" onBack={back} />);
  await fireEvent.press(screen.getByLabelText('Go back'));
  expect(back).toHaveBeenCalledTimes(1);
  expect(dismiss).toHaveBeenCalled();
  expect(router.dismissTo).not.toHaveBeenCalled();
});
test('repeated rapid taps issue one navigation, with a valid destination', () => {
  jest.spyOn(Date, 'now').mockReturnValue(10000);
  appNavigationTrail.record('/bills/data','qa',true);
  goBackSafely(); goBackSafely();
  expect(router.dismissTo).toHaveBeenCalledTimes(1);
  expect(router.dismissTo).toHaveBeenCalledWith('/bills');
});
