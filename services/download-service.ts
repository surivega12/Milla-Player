import * as FileSystem from 'expo-file-system/legacy';

const DOWNLOAD_DIR = FileSystem.documentDirectory + 'downloads/';

function getDownloadFileUri(trackId: string): string {
  const normalizedId = String(trackId || 'track');
  let hash = 0;
  for (let index = 0; index < normalizedId.length; index += 1) {
    hash = (hash * 31 + normalizedId.charCodeAt(index)) | 0;
  }
  const safeStem = normalizedId.replace(/[^a-z0-9_-]/gi, '_').slice(-72) || 'track';
  return `${DOWNLOAD_DIR}${safeStem}_${(hash >>> 0).toString(36)}.flac`;
}

// Asegura que la carpeta de descargas exista localmente
async function ensureDirExists() {
  try {
    const dirInfo = await FileSystem.getInfoAsync(DOWNLOAD_DIR);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(DOWNLOAD_DIR, { intermediates: true });
    }
  } catch (err) {
    console.error('Error ensuring downloads directory exists:', err);
  }
}

/**
 * Obtiene la URI local del archivo de audio descargado si existe.
 */
export async function getLocalTrackUri(trackId: string): Promise<string | null> {
  await ensureDirExists();
  const fileUri = getDownloadFileUri(trackId);
  const fileInfo = await FileSystem.getInfoAsync(fileUri);
  if (fileInfo.exists) {
    return fileUri;
  }
  return null;
}

/**
 * Descarga una canción remota en segundo plano y la guarda localmente.
 */
export async function downloadTrack(
  trackId: string,
  remoteUrl: string,
  onProgress: (progress: number) => void
): Promise<string> {
  await ensureDirExists();
  const fileUri = getDownloadFileUri(trackId);

  // Si ya se encuentra descargada, retornar inmediatamente la URI local
  const fileInfo = await FileSystem.getInfoAsync(fileUri);
  if (fileInfo.exists) {
    onProgress(1.0);
    return fileUri;
  }

  const downloadResumable = FileSystem.createDownloadResumable(
    remoteUrl,
    fileUri,
    {},
    (downloadProgress) => {
      const progress = downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite;
      onProgress(isNaN(progress) ? 0 : Math.min(Math.max(progress, 0), 1));
    }
  );

  const result = await downloadResumable.downloadAsync();
  if (!result || !result.uri) {
    throw new Error('No se pudo completar la descarga del archivo de audio.');
  }

  return result.uri;
}

/**
 * Elimina una canción descargada del almacenamiento local.
 */
export async function deleteTrackFile(trackId: string): Promise<void> {
  const fileUri = getDownloadFileUri(trackId);
  const fileInfo = await FileSystem.getInfoAsync(fileUri);
  if (fileInfo.exists) {
    await FileSystem.deleteAsync(fileUri);
  }
}

/**
 * Calcula el espacio total utilizado por los archivos de música descargados en MB.
 */
export async function getDownloadsFolderSize(): Promise<string> {
  await ensureDirExists();
  try {
    const dirInfo = await FileSystem.readDirectoryAsync(DOWNLOAD_DIR);
    let totalBytes = 0;
    for (const file of dirInfo) {
      const fileInfo = await FileSystem.getInfoAsync(DOWNLOAD_DIR + file);
      if (fileInfo.exists && !fileInfo.isDirectory) {
        totalBytes += fileInfo.size;
      }
    }
    return (totalBytes / (1024 * 1024)).toFixed(1) + ' MB';
  } catch (err) {
    return '0.0 MB';
  }
}

/**
 * Elimina todas las descargas almacenadas en la carpeta de descargas.
 */
export async function clearAllDownloads(): Promise<void> {
  const dirInfo = await FileSystem.getInfoAsync(DOWNLOAD_DIR);
  if (dirInfo.exists) {
    await FileSystem.deleteAsync(DOWNLOAD_DIR);
    await ensureDirExists();
  }
}
