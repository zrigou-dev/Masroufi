import { scrypt } from '@noble/hashes/scrypt.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import * as Crypto from 'expo-crypto';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const PIN_KEY = 'masroufi.pin';
const ATTEMPTS_KEY = 'masroufi.pin.attempts';

/** Lighter than the backup KDF: this runs on every unlock and must feel immediate. */
const PIN_KDF = { N: 2 ** 12, r: 8, p: 1, dkLen: 32 };

type StoredPin = { salt: string; hash: string };

function derive(pin: string, saltHex: string): string {
  const salt = Uint8Array.from(saltHex.match(/../g)?.map((byte) => parseInt(byte, 16)) ?? []);
  return bytesToHex(scrypt(utf8ToBytes(pin), salt, PIN_KDF));
}

export const lockSupported = Platform.OS !== 'web';

export async function savePin(pin: string): Promise<void> {
  const salt = bytesToHex(Crypto.getRandomBytes(16));
  const stored: StoredPin = { salt, hash: derive(pin, salt) };
  await SecureStore.setItemAsync(PIN_KEY, JSON.stringify(stored));
  await SecureStore.deleteItemAsync(ATTEMPTS_KEY);
}

export async function clearPin(): Promise<void> {
  await SecureStore.deleteItemAsync(PIN_KEY);
  await SecureStore.deleteItemAsync(ATTEMPTS_KEY);
}

export type PinResult = { ok: boolean; waitSeconds: number };

function waitAfter(failures: number): number {
  return failures < 5 ? 0 : Math.min(300, 30 * 2 ** (failures - 5));
}

/** Failed attempts back off exponentially, and the count survives restarting the app. */
export async function checkPin(pin: string): Promise<PinResult> {
  const raw = await SecureStore.getItemAsync(PIN_KEY);
  if (!raw) return { ok: false, waitSeconds: 0 };
  const attempts = JSON.parse((await SecureStore.getItemAsync(ATTEMPTS_KEY)) ?? '{"count":0,"until":0}') as { count: number; until: number };
  const remaining = Math.ceil((attempts.until - Date.now()) / 1000);
  if (remaining > 0) return { ok: false, waitSeconds: remaining };

  const stored = JSON.parse(raw) as StoredPin;
  if (derive(pin, stored.salt) === stored.hash) {
    await SecureStore.deleteItemAsync(ATTEMPTS_KEY);
    return { ok: true, waitSeconds: 0 };
  }
  const count = attempts.count + 1;
  const wait = waitAfter(count);
  await SecureStore.setItemAsync(ATTEMPTS_KEY, JSON.stringify({ count, until: Date.now() + wait * 1000 }));
  return { ok: false, waitSeconds: wait };
}

export async function deviceAuthAvailable(): Promise<boolean> {
  if (!lockSupported) return false;
  return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
}

export async function authenticateWithDevice(promptMessage: string): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({ promptMessage, disableDeviceFallback: false });
  return result.success;
}
