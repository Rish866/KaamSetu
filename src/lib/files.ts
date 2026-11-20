import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { Linking, Platform } from 'react-native';
import { supabase } from './supabase';

export const RESUME_TYPES = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
} as const;
export const PHOTO_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as const;
export const MAX_RESUME_BYTES = 5 * 1024 * 1024;
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

export type Picked = { name: string; mime: string; ext: string; bytes: ArrayBuffer; sha256: string };

/** Lets the user choose a file, validates type and size on the device, and hashes it. */
export async function pickFile(types: Record<string, string>, maxBytes: number): Promise<Picked | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: Object.keys(types), copyToCacheDirectory: true, multiple: false });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  const mime = asset.mimeType ?? '';
  const ext = types[mime];
  if (!ext) throw new Error('That file type is not allowed.');
  if (asset.size !== undefined && asset.size > maxBytes) throw new Error(`The file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  const bytes = await (await fetch(asset.uri)).arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) throw new Error(`Files must be between 1 byte and ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  const sha256 = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return { name: asset.name.slice(0, 120), mime, ext, bytes, sha256 };
}

export async function uploadResume(userId: string, file: Picked): Promise<string> {
  const path = `${userId}/${Crypto.randomUUID()}.${file.ext}`;
  const up = await supabase.storage.from('resumes').upload(path, file.bytes, { contentType: file.mime, upsert: false });
  if (up.error) throw up.error;
  const reg = await supabase.rpc('register_resume', { p_path: path, p_name: file.name, p_mime: file.mime, p_size: file.bytes.byteLength, p_sha256: file.sha256 });
  if (reg.error) { await supabase.storage.from('resumes').remove([path]); throw reg.error; }
  return reg.data as string;
}

/** Short-lived (60 s) signed link; the raw storage path is never shown to the user. */
export async function resumeLink(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('resumes').createSignedUrl(path, 60);
  if (error || !data) throw error ?? new Error('Could not create a download link.');
  return data.signedUrl;
}

/**
 * Opens a URL that is only known after an async step (e.g. a freshly signed download link).
 * On web, browsers block window.open() that happens after an await, so a blank tab is opened synchronously inside
 * the click handler and pointed at the URL when it is ready. On native, the system handler opens it.
 */
export async function openWhenReady(getUrl: () => Promise<string>): Promise<void> {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const win = window.open('', '_blank');
    try {
      const url = await getUrl();
      if (win) { win.opener = null; win.location.href = url; } else window.location.assign(url);
    } catch (e) { win?.close(); throw e; }
    return;
  }
  await Linking.openURL(await getUrl());
}
