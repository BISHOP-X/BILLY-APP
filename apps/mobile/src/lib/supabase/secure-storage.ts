import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const CHUNK_SIZE = 1_800;
const MANIFEST_VERSION = 1;
const KEY_PREFIX = 'billy.secure.';
const INSTALL_MARKER_KEY = 'billy.installation.initialized.v1';
const BIOMETRIC_LOCK_PREFERENCE_KEY =
  'billy.security.biometric-app-lock-enabled.v1';
export const AUTH_STORAGE_KEY = 'billy-auth-session-v1';

type SecureManifest = {
  chunkCount: number;
  generation: string;
  version: typeof MANIFEST_VERSION;
};

const secureStoreOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

function webStorage() {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.localStorage;
}

function normalizeKey(key: string) {
  return `${KEY_PREFIX}${key.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
}

function manifestKey(key: string) {
  return `${normalizeKey(key)}.manifest`;
}

function chunkKey(key: string, generation: string, index: number) {
  return `${normalizeKey(key)}.${generation}.${index}`;
}

function parseManifest(value: string | null): SecureManifest | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<SecureManifest>;

    if (
      parsed.version !== MANIFEST_VERSION ||
      typeof parsed.generation !== 'string' ||
      typeof parsed.chunkCount !== 'number' ||
      !Number.isInteger(parsed.chunkCount) ||
      parsed.chunkCount < 1
    ) {
      return null;
    }

    return parsed as SecureManifest;
  } catch {
    return null;
  }
}

async function deleteNativeGeneration(key: string, manifest: SecureManifest) {
  await Promise.all(
    Array.from({ length: manifest.chunkCount }, (_, index) =>
      SecureStore.deleteItemAsync(
        chunkKey(key, manifest.generation, index),
        secureStoreOptions,
      ),
    ),
  );
}

async function getNativeItem(key: string) {
  const manifest = parseManifest(
    await SecureStore.getItemAsync(manifestKey(key), secureStoreOptions),
  );

  if (!manifest) {
    return null;
  }

  const chunks = await Promise.all(
    Array.from({ length: manifest.chunkCount }, (_, index) =>
      SecureStore.getItemAsync(
        chunkKey(key, manifest.generation, index),
        secureStoreOptions,
      ),
    ),
  );

  if (chunks.some((chunk) => chunk === null)) {
    await SecureStore.deleteItemAsync(manifestKey(key), secureStoreOptions);
    await deleteNativeGeneration(key, manifest);
    return null;
  }

  return chunks.join('');
}

async function setNativeItem(key: string, value: string) {
  const previousManifest = parseManifest(
    await SecureStore.getItemAsync(manifestKey(key), secureStoreOptions),
  );
  const generation = `${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const chunks = Array.from(
    { length: Math.max(1, Math.ceil(value.length / CHUNK_SIZE)) },
    (_, index) => value.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE),
  );

  await Promise.all(
    chunks.map((chunk, index) =>
      SecureStore.setItemAsync(
        chunkKey(key, generation, index),
        chunk,
        secureStoreOptions,
      ),
    ),
  );

  const nextManifest: SecureManifest = {
    chunkCount: chunks.length,
    generation,
    version: MANIFEST_VERSION,
  };

  await SecureStore.setItemAsync(
    manifestKey(key),
    JSON.stringify(nextManifest),
    secureStoreOptions,
  );

  if (previousManifest) {
    await deleteNativeGeneration(key, previousManifest);
  }
}

async function removeNativeItem(key: string) {
  const manifest = parseManifest(
    await SecureStore.getItemAsync(manifestKey(key), secureStoreOptions),
  );

  await SecureStore.deleteItemAsync(manifestKey(key), secureStoreOptions);

  if (manifest) {
    await deleteNativeGeneration(key, manifest);
  }
}

let installBoundaryPromise: Promise<void> | null = null;

export function prepareBillySecureStorage() {
  if (Platform.OS === 'web') {
    return Promise.resolve();
  }

  if (!installBoundaryPromise) {
    installBoundaryPromise = (async () => {
      const installationInitialized =
        (await AsyncStorage.getItem(INSTALL_MARKER_KEY)) === 'true';

      if (installationInitialized) {
        return;
      }

      // iOS Keychain values can survive an uninstall while AsyncStorage does
      // not. Clear Billy's prior session and local lock before this fresh
      // installation is allowed to restore authentication.
      await Promise.all(
        [
          AUTH_STORAGE_KEY,
          `${AUTH_STORAGE_KEY}-code-verifier`,
          `${AUTH_STORAGE_KEY}-user`,
        ].map((key) => removeNativeItem(key)),
      );
      await SecureStore.deleteItemAsync(BIOMETRIC_LOCK_PREFERENCE_KEY);
      await AsyncStorage.setItem(INSTALL_MARKER_KEY, 'true');
    })().catch((error) => {
      installBoundaryPromise = null;
      throw error;
    });
  }

  return installBoundaryPromise;
}

export const authStorage = {
  async getItem(key: string) {
    if (Platform.OS === 'web') {
      return webStorage()?.getItem(key) ?? null;
    }

    await prepareBillySecureStorage();
    return getNativeItem(key);
  },
  async removeItem(key: string) {
    if (Platform.OS === 'web') {
      webStorage()?.removeItem(key);
      return;
    }

    await prepareBillySecureStorage();
    await removeNativeItem(key);
  },
  async setItem(key: string, value: string) {
    if (Platform.OS === 'web') {
      webStorage()?.setItem(key, value);
      return;
    }

    await prepareBillySecureStorage();
    await setNativeItem(key, value);
  },
};
