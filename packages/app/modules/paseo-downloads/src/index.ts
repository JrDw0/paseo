import { Platform } from "react-native";
import { requireNativeModule } from "expo-modules-core";

interface PaseoDownloadsSpec {
  copyToSaf(sourceUri: string, safUri: string): Promise<void>;
  openFile(sourceUri: string, mimeType: string | null): Promise<void>;
}

let nativeModule: PaseoDownloadsSpec | null = null;

function getNativeModule(): PaseoDownloadsSpec {
  if (Platform.OS !== "android") {
    throw new Error("PaseoDownloads is only available on Android.");
  }
  return (nativeModule ??= requireNativeModule<PaseoDownloadsSpec>("PaseoDownloads"));
}

/**
 * Streams a local file into a user-picked SAF document with constant memory.
 * The expo-file-system alternative (base64 writeAsStringAsync) OOMs on large
 * files; copyAsync cannot target tree-scoped content URIs at all.
 */
export function copyLocalFileToSafDocument(sourceUri: string, safUri: string): Promise<void> {
  return getNativeModule().copyToSaf(sourceUri, safUri);
}

/** Opens a local file in the device's default viewer via ACTION_VIEW. */
export function openLocalFileInViewer(sourceUri: string, mimeType: string | null): Promise<void> {
  return getNativeModule().openFile(sourceUri, mimeType);
}
