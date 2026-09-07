import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import PinSetupScreen from '@/app/(setup)/pin';
import { getMyProfile, updateMyProfile } from '@/features/auth/auth-api';
import { replaceFlowRoute } from '@/features/auth/setup-navigation';
import type { Profile } from '@/lib/supabase/database.types';

jest.mock('@/features/auth/auth-api', () => ({
  getMyProfile: jest.fn(),
  updateMyProfile: jest.fn(),
}));

jest.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({
    user: {
      user_metadata: {},
    },
  }),
}));

jest.mock('@/features/auth/setup-navigation', () => ({
  replaceFlowRoute: jest.fn(),
}));

jest.mock('@/hooks/use-reduced-motion', () => ({
  useReducedMotion: () => true,
}));

jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    rpc: jest.fn(),
  },
}));

const profile: Profile = {
  avatar_url: null,
  country_code: 'NG',
  created_at: '2026-09-06T00:00:00.000Z',
  date_of_birth: null,
  display_name: 'Innocent Wisdom',
  first_name: 'WISDOM',
  id: 'test-user',
  last_name: 'INNOCENT',
  onboarding_step: 'pin',
  onboarding_completed_at: null,
  phone: '+2349067679407',
  preferred_currency: 'NGN',
  profile_completed_at: '2026-09-06T00:00:00.000Z',
  updated_at: '2026-09-06T00:00:00.000Z',
};

describe('PIN profile review', () => {
  it('reviews saved details in place without triggering setup redirects', async () => {
    jest.mocked(getMyProfile).mockResolvedValue(profile);
    jest.mocked(updateMyProfile).mockResolvedValue(profile);

    await render(<PinSetupScreen />);

    await fireEvent.press(screen.getByLabelText('Go back'));

    expect(await screen.findByText('Review your details')).toBeTruthy();
    expect(await screen.findByDisplayValue('WISDOM')).toBeTruthy();
    expect(screen.getByDisplayValue('INNOCENT')).toBeTruthy();
    expect(screen.getByDisplayValue('Innocent Wisdom')).toBeTruthy();
    expect(screen.getByDisplayValue('+2349067679407')).toBeTruthy();
    expect(replaceFlowRoute).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('profile-continue'));

    await waitFor(() => {
      expect(updateMyProfile).toHaveBeenCalledWith({
        display_name: 'Innocent Wisdom',
        first_name: 'WISDOM',
        last_name: 'INNOCENT',
        phone: '+2349067679407',
      });
      expect(screen.getByText('Create your Billy PIN')).toBeTruthy();
    });
    expect(replaceFlowRoute).not.toHaveBeenCalled();
  });
});
