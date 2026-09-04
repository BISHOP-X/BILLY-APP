export type GoogleAuthIntent = 'sign-in' | 'sign-up';

export type GoogleIdentityButtonProps = {
  disabled: boolean;
  intent: GoogleAuthIntent;
  loading: boolean;
  onConfigurationError: (message: string) => void;
  onIdToken: (token: string, nonce: string) => void;
  onOAuthPress: () => void;
};
