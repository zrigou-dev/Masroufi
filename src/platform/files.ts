import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

function downloadOnWeb(name: string, content: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: `${mimeType};charset=utf-8` }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/** Hands a generated file to the system share sheet, removing the local copy afterwards. */
export async function shareTextFile(name: string, content: string, mimeType: string): Promise<void> {
  if (Platform.OS === 'web') {
    downloadOnWeb(name, content, mimeType);
    return;
  }
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(content);
  try {
    await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: name });
  } finally {
    if (file.exists) file.delete();
  }
}

/** A safety copy kept in app storage, written just before a restore replaces everything. */
export function writeSafetyCopy(name: string, content: string): void {
  if (Platform.OS === 'web') return;
  const file = new File(Paths.document, name);
  if (file.exists) file.delete();
  file.create();
  file.write(content);
}

export async function pickTextFile(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'application/octet-stream', 'text/plain', '*/*'], copyToCacheDirectory: true });
  if (result.canceled || !result.assets?.[0]) return null;
  const { uri } = result.assets[0];
  if (Platform.OS === 'web') return (await fetch(uri)).text();
  return new File(uri).text();
}
