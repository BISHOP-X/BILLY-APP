import { GoogleLogin, GoogleOAuthProvider, type CredentialResponse } from '@react-oauth/google';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { typography } from '@/theme/tokens';

import type { GoogleIdentityButtonProps } from './google-identity-button.types';

const googleClientId = process.env.EXPO_PUBLIC_GOOGLE_AUTH_WEB_CLIENT_ID?.trim() ?? '';

type NoncePair = {
  hashed: string;
  raw: string;
};

async function createNoncePair(): Promise<NoncePair> {
  const randomBytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(randomBytes);
  const raw = Array.from(randomBytes, (value) => value.toString(16).padStart(2, '0')).join('');
  const encoded = new TextEncoder().encode(raw);
  const hash = await globalThis.crypto.subtle.digest('SHA-256', encoded);
  const hashed = Array.from(new Uint8Array(hash), (value) =>
    value.toString(16).padStart(2, '0'),
  ).join('');

  return { hashed, raw };
}

export function GoogleIdentityButton({
  disabled,
  intent,
  loading,
  onConfigurationError,
  onIdToken,
}: GoogleIdentityButtonProps) {
  const { width: viewportWidth } = useWindowDimensions();
  const [noncePair, setNoncePair] = useState<NoncePair | null>(null);
  const buttonWidth = Math.min(320, Math.max(220, viewportWidth - 112));

  useEffect(() => {
    let active = true;

    void createNoncePair()
      .then((pair) => {
        if (active) setNoncePair(pair);
      })
      .catch(() => {
        if (active) {
          onConfigurationError('Billy could not securely prepare Google sign-in. Please try again.');
        }
      });

    return () => {
      active = false;
    };
  }, [onConfigurationError]);

  if (!googleClientId) {
    return (
      <View accessibilityRole="alert" style={styles.unavailable}>
        <Text style={styles.unavailableText}>Google sign-in is temporarily unavailable.</Text>
      </View>
    );
  }

  if (!noncePair) {
    return (
      <View accessibilityLabel="Preparing Google sign-in" style={styles.loadingButton}>
        <ActivityIndicator color="#146237" />
      </View>
    );
  }

  function handleSuccess(response: CredentialResponse) {
    if (!response.credential) {
      onConfigurationError('Google did not return a sign-in credential. Please try again.');
      return;
    }

    onIdToken(response.credential, noncePair!.raw);
  }

  return (
    <GoogleOAuthProvider clientId={googleClientId}>
      <View style={[styles.googleContainer, disabled || loading ? styles.disabled : null]}>
        <GoogleLogin
          containerProps={{ style: styles.googleHost }}
          logo_alignment="left"
          nonce={noncePair.hashed}
          onError={() =>
            onConfigurationError('Google sign-in was not completed. Please try again.')
          }
          onSuccess={handleSuccess}
          shape="pill"
          size="large"
          text={intent === 'sign-up' ? 'signup_with' : 'signin_with'}
          theme="outline"
          type="standard"
          width={buttonWidth}
        />
        {disabled || loading ? (
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.overlay}>
            {loading ? <ActivityIndicator color="#146237" /> : null}
          </View>
        ) : null}
      </View>
    </GoogleOAuthProvider>
  );
}

const styles = StyleSheet.create({
  disabled: {
    opacity: 0.62,
  },
  googleContainer: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    maxWidth: 340,
    position: 'relative',
    width: '100%',
  },
  googleHost: {
    display: 'flex',
    justifyContent: 'center',
    width: '100%',
  },
  loadingButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#DADCE0',
    borderRadius: 22,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    maxWidth: 340,
    width: '100%',
  },
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
    borderRadius: 22,
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  unavailable: {
    alignItems: 'center',
    backgroundColor: '#F7F8F7',
    borderColor: '#DCE5DF',
    borderRadius: 22,
    borderWidth: 1,
    justifyContent: 'center',
    maxWidth: 340,
    minHeight: 44,
    paddingHorizontal: 16,
    width: '100%',
  },
  unavailableText: {
    color: '#66736B',
    fontFamily: typography.family,
    fontSize: 13,
    textAlign: 'center',
  },
});
