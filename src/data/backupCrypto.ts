import { gcm } from '@noble/ciphers/aes.js';
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';

import { fail } from '../domain/errors';

export const ENCRYPTED_FORMAT = 'masroufi-backup-encrypted';

/** N=2^15 needs about 32 MB and is a workable cost for a pure-JS scrypt on a phone. */
const DEFAULT_KDF = { N: 2 ** 15, r: 8, p: 1 };
/** A file is untrusted input: refuse parameters that could exhaust memory before it authenticates. */
const MAX_N = 2 ** 18;

type KdfParams = { name: 'scrypt'; N: number; r: number; p: number; salt: string };

export type EncryptedBackup = {
  format: typeof ENCRYPTED_FORMAT;
  version: 1;
  kdf: KdfParams;
  cipher: 'aes-256-gcm';
  nonce: string;
  ciphertext: string;
};

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    out += ALPHABET[a >> 2] + ALPHABET[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < bytes.length ? ALPHABET[((b & 15) << 2) | (c >> 6)] : '=';
    out += i + 2 < bytes.length ? ALPHABET[c & 63] : '=';
  }
  return out;
}

export function fromBase64(text: string): Uint8Array {
  if (text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) fail('backup_corrupt');
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((text.length / 4) * 3 - padding);
  let position = 0;
  for (let i = 0; i < text.length; i += 4) {
    const value = [0, 1, 2, 3].reduce((acc, k) => (acc << 6) | Math.max(0, ALPHABET.indexOf(text[i + k])), 0);
    for (const shift of [16, 8, 0]) {
      if (position < out.length) out[position++] = (value >> shift) & 255;
    }
  }
  return out;
}

const deriveKey = (password: string, kdf: Omit<KdfParams, 'name' | 'salt'>, salt: Uint8Array) =>
  scryptAsync(utf8ToBytes(password.normalize('NFKC')), salt, { N: kdf.N, r: kdf.r, p: kdf.p, dkLen: 32, maxmem: 2 ** 29 });

/** The parameters are authenticated with the data, so a file cannot be silently downgraded. */
const additionalData = (kdf: KdfParams) => utf8ToBytes(`${ENCRYPTED_FORMAT}:1:${JSON.stringify(kdf)}`);

export async function encryptBackup(plaintext: string, password: string, randomBytes: (n: number) => Uint8Array): Promise<string> {
  if (!password) fail('backup_password');
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const kdf: KdfParams = { name: 'scrypt', ...DEFAULT_KDF, salt: toBase64(salt) };
  const key = await deriveKey(password, kdf, salt);
  const ciphertext = gcm(key, nonce, additionalData(kdf)).encrypt(utf8ToBytes(plaintext));
  const file: EncryptedBackup = {
    format: ENCRYPTED_FORMAT,
    version: 1,
    kdf,
    cipher: 'aes-256-gcm',
    nonce: toBase64(nonce),
    ciphertext: toBase64(ciphertext),
  };
  return JSON.stringify(file);
}

export function isEncryptedBackup(text: string): boolean {
  try {
    return (JSON.parse(text) as { format?: string } | null)?.format === ENCRYPTED_FORMAT;
  } catch {
    return false;
  }
}

export async function decryptBackup(text: string, password: string): Promise<string> {
  let file: EncryptedBackup;
  try {
    file = JSON.parse(text) as EncryptedBackup;
  } catch {
    fail('backup_corrupt');
  }
  const kdf = file.kdf;
  if (file.format !== ENCRYPTED_FORMAT || file.version !== 1 || file.cipher !== 'aes-256-gcm' || kdf?.name !== 'scrypt') fail('backup_invalid');
  const powerOfTwo = Number.isInteger(kdf.N) && kdf.N > 1 && (kdf.N & (kdf.N - 1)) === 0;
  if (!powerOfTwo || kdf.N > MAX_N || kdf.r !== 8 || !Number.isInteger(kdf.p) || kdf.p < 1 || kdf.p > 4) fail('backup_invalid');

  const key = await deriveKey(password, kdf, fromBase64(kdf.salt));
  try {
    const plain = gcm(key, fromBase64(file.nonce), additionalData(kdf)).decrypt(fromBase64(file.ciphertext));
    return new TextDecoder().decode(plain);
  } catch {
    // Authenticated encryption cannot tell a wrong password from a tampered file.
    fail('backup_password');
  }
}
