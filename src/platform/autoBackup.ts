import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

/**
 * Daily safety copies kept in the app's own storage. They protect against mistakes and a damaged
 * database, not against losing the phone or clearing the browser: that needs an exported backup.
 */
const KEEP = 7;
const WEB_DB = 'masroufi-auto-backups';
const WEB_STORE = 'backups';

function webStore(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(WEB_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(WEB_STORE);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result.transaction(WEB_STORE, mode).objectStore(WEB_STORE));
  });
}

const webRequest = <T,>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

function nativeFolder(): Directory {
  const folder = new Directory(Paths.document, 'auto-backups');
  if (!folder.exists) folder.create();
  return folder;
}

export async function listAutoBackups(): Promise<string[]> {
  if (Platform.OS === 'web') {
    const keys = await webRequest((await webStore('readonly')).getAllKeys());
    return keys.map(String).sort().reverse();
  }
  return nativeFolder()
    .list()
    .map((entry) => entry.name.replace(/\.json$/, ''))
    .sort()
    .reverse();
}

export async function saveAutoBackup(date: string, text: string): Promise<void> {
  if (Platform.OS === 'web') {
    await webRequest((await webStore('readwrite')).put(text, date));
  } else {
    const file = new File(nativeFolder(), `${date}.json`);
    if (file.exists) file.delete();
    file.create();
    file.write(text);
  }
  for (const old of (await listAutoBackups()).slice(KEEP)) {
    if (Platform.OS === 'web') await webRequest((await webStore('readwrite')).delete(old));
    else new File(nativeFolder(), `${old}.json`).delete();
  }
}

export async function readAutoBackup(date: string): Promise<string> {
  if (Platform.OS === 'web') return String(await webRequest((await webStore('readonly')).get(date)));
  return new File(nativeFolder(), `${date}.json`).text();
}

/** Asks the browser not to evict the app's storage when disk runs low. No effect on native. */
export async function requestDurableStorage(): Promise<void> {
  if (Platform.OS === 'web') await navigator.storage?.persist?.();
}
