import * as MediaLibrary from 'expo-media-library/legacy';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { Track } from '../components/PlayerBar';
import { extractMetadata } from './metadata-service';
import { getCachedTracks, insertTracks, deleteTracks, updateTrackUri, setWebMockTracks } from './database-service';
import jsmediatags from 'jsmediatags';

export async function requestLibraryPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return true;
  const { status, canAskAgain } = await MediaLibrary.getPermissionsAsync(false, ['audio']);
  if (status === 'granted') return true;
  if (status === 'undetermined' || canAskAgain) {
    const { status: newStatus } = await MediaLibrary.requestPermissionsAsync(false, ['audio']);
    return newStatus === 'granted';
  }
  return false;
}

const AUDIO_EXTENSIONS_REGEX = /\.(mp3|flac|wav|m4a|aac|ogg|dsd|dff|dsf)$/i;

function getFileQualityBadge(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (ext === 'flac') return 'FLAC Lossless';
  if (ext === 'wav') return 'WAV Lossless';
  if (ext === 'dsf' || ext === 'dff' || ext === 'dsd') return 'DSD Direct';
  if (ext === 'm4a' || ext === 'aac') return 'AAC Audio';
  if (ext === 'ogg') return 'OGG Vorbis';
  if (ext === 'mp3') return 'MP3 Audio';
  return `${ext.toUpperCase() || 'AUDIO'} Universal`;
}

/**
 * Decodifica URIs de forma segura anti-crashes por secuencias % malformadas.
 */
function decodeURIComponentSafe(uri: string): string {
  if (!uri) return '';
  try {
    return decodeURIComponent(uri);
  } catch (err) {
    try {
      return unescape(uri);
    } catch (e) {
      return uri;
    }
  }
}

/**
 * Normaliza y formatea URIs nativas devueltas por el selector de carpetas (Storage Access Framework / FileSystem)
 * para resolver subcarpetas con prefijos content:// o file:// en compilaciones de producción (.apk).
 */
export function normalizeNativeUri(uri: string): string {
  if (!uri) return '';
  const decoded = decodeURIComponentSafe(uri);
  if (decoded.startsWith('content://')) {
    return decoded;
  }
  if (decoded.startsWith('file://')) {
    return decoded;
  }
  if (decoded.startsWith('/')) {
    return `file://${decoded}`;
  }
  return decoded;
}

const SAF_EXTERNAL_STORAGE_PREFIX = 'content://com.android.externalstorage.documents/';

function toFileUri(absolutePath: string): string {
  const normalizedPath = absolutePath.replace(/\\/g, '/').replace(/\/+/g, '/');
  return `file://${encodeURI(normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`)}`;
}

function getSafDocumentId(uri: string): string | null {
  const decoded = decodeURIComponentSafe(uri);
  const documentIndex = decoded.lastIndexOf('/document/');
  const treeIndex = decoded.lastIndexOf('/tree/');
  const markerIndex = documentIndex >= 0 ? documentIndex + '/document/'.length : treeIndex >= 0 ? treeIndex + '/tree/'.length : -1;

  if (markerIndex < 0) return null;
  const documentId = decoded.slice(markerIndex).split('?')[0].replace(/^\/+/, '');
  return documentId || null;
}

/**
 * Convierte los Document IDs de SAF en rutas que ExoPlayer y los lectores de tags pueden abrir.
 * SAF no expone un API de JavaScript para resolver todos los proveedores de documentos; este puente
 * cubre los documentos de almacenamiento externo de Android, incluidos los volúmenes SD montados.
 */
export function resolveAndroidContentUriToFileUri(uri: string): string | null {
  if (Platform.OS !== 'android' || !uri) return null;

  const decoded = decodeURIComponentSafe(uri);
  if (!decoded.startsWith(SAF_EXTERNAL_STORAGE_PREFIX)) return null;

  const documentId = getSafDocumentId(decoded);
  if (!documentId) return null;

  if (documentId.startsWith('raw:')) {
    return toFileUri(documentId.slice('raw:'.length));
  }

  const separatorIndex = documentId.indexOf(':');
  if (separatorIndex <= 0) return null;

  const volume = documentId.slice(0, separatorIndex);
  const relativePath = documentId.slice(separatorIndex + 1).replace(/^\/+/, '');
  const storageRoot = volume.toLowerCase() === 'primary' ? '/storage/emulated/0' : `/storage/${volume}`;
  return toFileUri(relativePath ? `${storageRoot}/${relativePath}` : storageRoot);
}

export function isUnresolvedSafUri(uri: string): boolean {
  return decodeURIComponentSafe(uri).startsWith(SAF_EXTERNAL_STORAGE_PREFIX);
}

/**
 * Sanitiza una ruta justo antes de persistirla o reproducirla. Los URIs de MediaStore ajenos a SAF
 * se preservan porque Android puede concederles acceso directo; los de SAF se convierten a file://.
 */
export function sanitizeTrackUriForPlayback(uri: string): string {
  if (!uri) return '';

  const resolvedSafUri = resolveAndroidContentUriToFileUri(uri);
  if (resolvedSafUri) return resolvedSafUri;

  const normalized = normalizeNativeUri(uri);
  if (normalized.startsWith('file://')) {
    return toFileUri(normalized.slice('file://'.length));
  }
  return normalized.startsWith('/') ? toFileUri(normalized) : normalized;
}

/**
 * Helper para generar huella única anti-duplicados usando nombre de archivo + duración exacta en milisegundos.
 */
function getTrackFingerprint(filename: string, durationSec?: number): string {
  const cleanName = decodeURIComponentSafe(filename).trim().toLowerCase().replace(/\.[^/.]+$/, '');
  const durationMs = Math.round((durationSec || 0) * 1000);
  return `${cleanName}_${durationMs}`;
}

/**
 * Busca y vincula automáticamente archivos de letras (.lrc o .txt) ubicados en la misma carpeta del archivo de audio.
 */
async function findAndLinkLyricsNative(asset: any): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    let fileUri = asset.uri;
    if (!fileUri.startsWith('file://') && !fileUri.startsWith('content://')) {
      try {
        const info = await MediaLibrary.getAssetInfoAsync(asset.id || asset);
        if (info && info.localUri) {
          fileUri = info.localUri;
        }
      } catch (e) {}
    }

    if (fileUri && (fileUri.startsWith('file://') || fileUri.startsWith('content://'))) {
      const lastSlashIdx = fileUri.lastIndexOf('/');
      if (lastSlashIdx !== -1) {
        const dirPath = fileUri.substring(0, lastSlashIdx + 1);
        const filename = asset.filename || fileUri.substring(lastSlashIdx + 1);
        const baseName = decodeURIComponentSafe(filename).replace(/\.[^/.]+$/, '');

        // 1. Verificar archivo con extensión .lrc
        const lrcPathEncoded = `${dirPath}${encodeURIComponent(baseName)}.lrc`;
        const lrcPathRaw = `${dirPath}${baseName}.lrc`;
        const lrcInfo = await FileSystem.getInfoAsync(lrcPathRaw).catch(() => null) || await FileSystem.getInfoAsync(lrcPathEncoded).catch(() => null);
        if (lrcInfo && lrcInfo.exists && !lrcInfo.isDirectory) {
          const content = await FileSystem.readAsStringAsync(lrcInfo.uri || lrcPathRaw, { encoding: FileSystem.EncodingType.UTF8 });
          if (content && content.trim().length > 0) {
            console.log(`[LibraryService] Letra LRC vinculada con éxito para: ${baseName}`);
            return content.trim();
          }
        }

        // 2. Verificar archivo con extensión .txt
        const txtPathEncoded = `${dirPath}${encodeURIComponent(baseName)}.txt`;
        const txtPathRaw = `${dirPath}${baseName}.txt`;
        const txtInfo = await FileSystem.getInfoAsync(txtPathRaw).catch(() => null) || await FileSystem.getInfoAsync(txtPathEncoded).catch(() => null);
        if (txtInfo && txtInfo.exists && !txtInfo.isDirectory) {
          const content = await FileSystem.readAsStringAsync(txtInfo.uri || txtPathRaw, { encoding: FileSystem.EncodingType.UTF8 });
          if (content && content.trim().length > 0) {
            console.log(`[LibraryService] Letra TXT vinculada con éxito para: ${baseName}`);
            return content.trim();
          }
        }
      }
    }
  } catch (err) {
    console.warn('[LibraryService] Error buscando letras físicas en carpeta:', err);
  }
  return null;
}

/**
 * Selector de carpetas y archivos híbrido universal para entorno Web (Local Host).
 */
async function scanWebFolderHybrid(
  onProgress?: (progressText: string, count: number, total?: number) => void
): Promise<Track[]> {
  return new Promise((resolve) => {
    try {
      if (typeof document === 'undefined') {
        resolve(getCachedTracks());
        return;
      }

      const input = document.createElement('input');
      input.type = 'file';
      input.webkitdirectory = true;
      input.multiple = true;

      input.onchange = async (e: any) => {
        const files: File[] = Array.from(e.target.files || []);
        if (files.length === 0) {
          resolve(await getCachedTracks());
          return;
        }

        if (onProgress) onProgress(`Analizando ${files.length} archivos de la carpeta...`, 0, files.length);

        const audioFiles = files.filter(f => {
          const nameLower = f.name.toLowerCase();
          return AUDIO_EXTENSIONS_REGEX.test(nameLower) || ['mp3', 'flac', 'wav', 'm4a', 'aac', 'ogg', 'dsd', 'dff', 'dsf'].some(ext => nameLower.endsWith(`.${ext}`)) || f.type.startsWith('audio/');
        });
        const lyricsFiles = files.filter(f => f.name.toLowerCase().endsWith('.lrc') || f.name.toLowerCase().endsWith('.txt'));

        if (audioFiles.length === 0) {
          if (onProgress) onProgress('No se encontraron archivos de audio compatibles.', 0, 0);
          resolve(await getCachedTracks());
          return;
        }

        if (onProgress) onProgress(`Escaneando ${audioFiles.length} canciones...`, 0, audioFiles.length);

        const newWebTracks: Track[] = [];
        for (let i = 0; i < audioFiles.length; i++) {
          const file = audioFiles[i];
          if (onProgress && (i % 5 === 0 || i === audioFiles.length - 1)) {
            onProgress(`Escaneando ${i + 1} de ${audioFiles.length} canciones...`, i + 1, audioFiles.length);
          }

          const cleanName = file.name.replace(/\.[^/.]+$/, '');
          const matchingLyricsFile = lyricsFiles.find(
            lf => lf.name.replace(/\.[^/.]+$/, '').toLowerCase() === cleanName.toLowerCase()
          );

          let lyricsText: string | undefined = undefined;
          if (matchingLyricsFile) {
            try {
              lyricsText = await matchingLyricsFile.text();
            } catch (err) {}
          }

          // Los Blob URL del selector sólo son válidos durante esta sesión. Se usan de forma
          // transitoria para evitar retener archivos completos en memoria del navegador.
          const transientUrl = URL.createObjectURL(file);
          try {
            const badge = getFileQualityBadge(file.name);
            const tags: any = await new Promise((resolveTags) => {
              jsmediatags.read(file, {
                onSuccess: (tag: any) => resolveTags(tag.tags),
                onError: () => resolveTags(null),
              });
            });

            let base64Cover: string | undefined;
            if (tags?.picture) {
              const { data, format } = tags.picture;
              let base64String = '';
              for (let j = 0; j < data.length; j++) {
                base64String += String.fromCharCode(data[j]);
              }
              base64Cover = `data:${format};base64,${btoa(base64String)}`;
            }

            newWebTracks.push({
              id: `web-local-${cleanName}_${file.size}`,
              // El navegador no permite persistir el File seleccionado entre recargas. No se
              // conserva el Blob URL revocado como una pista reproducible falsa.
              url: '',
              title: tags?.title || cleanName.replace(/_/g, ' '),
              artist: tags?.artist || 'Unknown Artist',
              album: tags?.album || '',
              duration: Math.round((file.size || 5000000) / 32000),
              qualityBadge: badge,
              lyrics_lrc: lyricsText,
              lyrics: lyricsText,
              needs_repair: false,
              needs_sync: false,
              artwork: base64Cover,
              artwork_thumb: base64Cover,
            });
          } finally {
            URL.revokeObjectURL(transientUrl);
          }
        }

        await setWebMockTracks(newWebTracks);
        if (onProgress) onProgress(`¡${newWebTracks.length} canciones compatibles indexadas!`, newWebTracks.length, newWebTracks.length);
        resolve(newWebTracks);
      };

      input.oncancel = async () => {
        resolve(await getCachedTracks());
      };

      input.click();
    } catch (err) {
      console.warn('[LibraryService] Error en escáner web híbrido:', err);
      getCachedTracks().then(resolve);
    }
  });
}

/** Escáner recursivo de carpetas locales y SAF sin diálogos de depuración. */
export async function readDirectoryRecursivelyNative(
  dirUri: string,
  onProgress?: (progressText: string, current: number, total?: number) => void,
  collectedAssets: any[] = [],
  visitedDirs: Set<string> = new Set()
): Promise<any[]> {
  try {
    if (!dirUri) return collectedAssets;
    
    const normalizedDir = normalizeNativeUri(dirUri);
    if (visitedDirs.has(normalizedDir)) return collectedAssets;
    visitedDirs.add(normalizedDir);

    if (normalizedDir.startsWith('content://')) {
      const items = await FileSystem.StorageAccessFramework.readDirectoryAsync(normalizedDir);
      for (let i = 0; i < items.length; i++) {
        const itemUri = items[i];
        if (onProgress && i % 10 === 0) {
          onProgress(`Explorando carpeta (${collectedAssets.length} audios hallados)...`, collectedAssets.length);
        }
        try {
          const decodedUri = decodeURIComponentSafe(itemUri);
          const rawFilename = decodedUri.split('/').pop()?.split('%2F').pop()?.split('?')[0] || 'unknown';
          const ext = rawFilename.split('.').pop()?.toLowerCase() || '';

          const isAudioExt = ['mp3', 'flac', 'wav', 'm4a', 'aac', 'ogg', 'dsd', 'dff', 'dsf'].includes(ext);
          if (isAudioExt) {
            const info = await FileSystem.getInfoAsync(itemUri).catch(() => null);
            collectedAssets.push({
              // Conservamos la URI SAF como origen sólo para poder migrar registros antiguos.
              // La pista indexada usa file:// siempre que el Document ID sea resoluble.
              uri: sanitizeTrackUriForPlayback(itemUri),
              sourceUri: itemUri,
              filename: decodeURIComponentSafe(rawFilename),
              mediaType: 'audio',
              duration: 180,
              size: (info as any)?.size || 0
            });
          } else {
            // getInfoAsync no informa isDirectory de forma fiable para hijos SAF. Intentamos
            // explícitamente abrir el documento como directorio para cubrir Artista/Álbum.
            try {
              await FileSystem.StorageAccessFramework.readDirectoryAsync(itemUri);
              await readDirectoryRecursivelyNative(itemUri, onProgress, collectedAssets, visitedDirs);
            } catch {
              // Es un archivo no musical o un proveedor que no expone la carpeta; se omite.
            }
          }
        } catch (subErr) {
          console.warn(`[LibraryService] Ignorando ítem/subcarpeta protegido: ${itemUri}`, subErr);
        }
      }
    } else {
      const dirPath = normalizedDir.startsWith('file://') ? normalizedDir : `file://${normalizedDir}`;
      const items = await FileSystem.readDirectoryAsync(dirPath);
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (onProgress && i % 10 === 0) {
          onProgress(`Explorando carpeta (${collectedAssets.length} audios hallados)...`, collectedAssets.length);
        }
        try {
          const itemPath = `${dirPath.endsWith('/') ? dirPath : dirPath + '/'}${item}`;
          const info = await FileSystem.getInfoAsync(itemPath).catch(() => null);
          if (info && info.isDirectory) {
            await readDirectoryRecursivelyNative(itemPath, onProgress, collectedAssets, visitedDirs);
          } else if (info && info.exists) {
            const rawFilename = decodeURIComponentSafe(item);
            const ext = rawFilename.split('.').pop()?.toLowerCase() || '';
            const isAudioExt = ['mp3', 'flac', 'wav', 'm4a', 'aac', 'ogg', 'dsd', 'dff', 'dsf'].includes(ext);
            if (isAudioExt) {
              collectedAssets.push({
                uri: sanitizeTrackUriForPlayback(itemPath),
                sourceUri: itemPath,
                filename: rawFilename,
                mediaType: 'audio',
                duration: 180,
                size: (info as any).size || 0
              });
            }
          }
        } catch (subErr) {
          console.warn(`[LibraryService] Ignorando ítem protegido: ${item}`, subErr);
        }
      }
    }
  } catch (dirErr: any) {
    console.warn("[LibraryService] Error leyendo directorio en readDirectoryRecursivelyNative:", dirErr);
  }
  return collectedAssets;
}

const PERSISTED_FOLDER_FILE = `${FileSystem.documentDirectory}milla_selected_music_folder.txt`;

/**
 * Obtiene la URI de la carpeta de música previamente elegida por el usuario.
 */
export async function getPersistedFolderUri(): Promise<string | null> {
  try {
    const info = await FileSystem.getInfoAsync(PERSISTED_FOLDER_FILE);
    if (!info.exists) return null;
    const content = await FileSystem.readAsStringAsync(PERSISTED_FOLDER_FILE);
    return content ? content.trim() : null;
  } catch (e) {
    return null;
  }
}

/**
 * Guarda de forma persistente la URI de la carpeta de música seleccionada por el usuario.
 */
export async function savePersistedFolderUri(uri: string): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(PERSISTED_FOLDER_FILE, uri);
  } catch (e) {}
}

/**
 * Borra la carpeta persistida para forzar una nueva selección.
 */
export async function clearPersistedFolderUri(): Promise<void> {
  try {
    await FileSystem.deleteAsync(PERSISTED_FOLDER_FILE, { idempotent: true });
  } catch (e) {}
}

/**
 * Abre OBLIGATORIAMENTE el selector nativo de carpetas de Android (Storage Access Framework)
 * para que el usuario elija explícitamente qué carpeta desea escanear (ej. Music o Download).
 */
export async function selectManualMusicFolder(): Promise<string | null> {
  if (Platform.OS !== 'android') return null;
  try {
    const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (permissions.granted && permissions.directoryUri) {
      await savePersistedFolderUri(permissions.directoryUri);
      return permissions.directoryUri;
    }
  } catch (err) {
    console.warn('[LibraryService] Error al abrir selector nativo SAF:', err);
  }
  return null;
}

async function resolvePlayableAssetUri(asset: any): Promise<string> {
  const sourceUri = asset?.sourceUri || asset?.uri || asset?.localUri || '';
  const directUri = sanitizeTrackUriForPlayback(sourceUri);
  const needsMediaLibraryLookup = sourceUri.startsWith('content://') && Boolean(asset?.id) && !directUri.startsWith('file://');

  if (directUri && !isUnresolvedSafUri(directUri) && !needsMediaLibraryLookup) {
    return directUri;
  }

  // MediaLibrary puede entregar localUri para activos indexados por Android. Se prioriza sobre
  // content:// para que TrackPlayer y jsmediatags reciban una ruta local cuando esté disponible.
  if (asset?.id) {
    try {
      const info: any = await MediaLibrary.getAssetInfoAsync(asset.id);
      const resolvedInfoUri = info?.localUri || info?.uri || '';
      const playableUri = sanitizeTrackUriForPlayback(resolvedInfoUri);
      if (playableUri && !isUnresolvedSafUri(playableUri)) {
        return playableUri;
      }
    } catch (error) {
      console.warn('[LibraryService] No se pudo resolver localUri de MediaLibrary:', error);
    }
  }

  return directUri;
}

async function resolveScannedAssets(allAssets: any[]): Promise<any[]> {
  const resolvedAssets: any[] = [];
  const BATCH_SIZE = 20;

  for (let index = 0; index < allAssets.length; index += BATCH_SIZE) {
    const batch = await Promise.all(allAssets.slice(index, index + BATCH_SIZE).map(async (asset) => ({
      ...asset,
      sourceUri: asset.sourceUri || asset.uri,
      uri: await resolvePlayableAssetUri(asset),
    })));
    resolvedAssets.push(...batch);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  return resolvedAssets;
}

export async function scanDeviceAudioFiles(
  onProgress?: (progressText: string, currentCount: number, totalCount?: number) => void
): Promise<Track[]> {
  return scanLocalAudioFiles(onProgress);
}

export async function scanManualMusicFolder(
  onProgress?: (progressText: string, currentCount: number, totalCount?: number) => void,
  customFolderUri?: string
): Promise<Track[]> {
  return scanLocalAudioFiles(onProgress, customFolderUri, true);
}

/**
 * Escanea MediaLibrary globalmente por defecto. El modo manual sólo entra cuando la UI solicita
 * explícitamente SAF, evitando que un permiso concedido abra siempre el selector de carpetas.
 */
export async function scanLocalAudioFiles(
  onProgress?: (progressText: string, currentCount: number, totalCount?: number) => void,
  customFolderUri?: string,
  forceManualSelection?: boolean
): Promise<Track[]> {
  try {
    if (Platform.OS === 'web') {
      return await scanWebFolderHybrid(onProgress);
    }

    const hasPermission = await requestLibraryPermission();
    if (!hasPermission && !forceManualSelection) {
      throw new Error('Permisos para acceder a la biblioteca multimedia denegados. Actívalos en Ajustes.');
    }

    let targetFolderUri: string | undefined = customFolderUri;

    if (forceManualSelection) {
      if (onProgress) onProgress('Abriendo selector de carpetas de tu dispositivo...', 0);
      const selectedUri = await selectManualMusicFolder();
      if (selectedUri) {
        targetFolderUri = selectedUri;
      } else {
        // Si cancela, revisamos si ya tenía una carpeta anterior guardada en disco
        const savedUri = await getPersistedFolderUri();
        if (savedUri) {
          targetFolderUri = savedUri;
        } else {
          return await getCachedTracks();
        }
      }
    }

    if (onProgress) {
      onProgress(targetFolderUri ? 'Leyendo carpeta seleccionada...' : 'Leyendo audios del dispositivo...', 0);
    }

    const cachedTracks = await getCachedTracks();
    const cachedIds = new Set(cachedTracks.map(t => t.id));

    let allAssets: any[] = [];
    if (targetFolderUri) {
      allAssets = await readDirectoryRecursivelyNative(targetFolderUri, onProgress);
    } else {
      let hasNextPage = true;
      let afterCursor: string | undefined = undefined;

      while (hasNextPage && allAssets.length < 10000) {
        try {
          const mediaPage = await MediaLibrary.getAssetsAsync({
            mediaType: MediaLibrary.MediaType.audio,
            first: 500,
            after: afterCursor,
          });
          allAssets = allAssets.concat(mediaPage.assets);
          hasNextPage = mediaPage.hasNextPage;
          afterCursor = mediaPage.endCursor;
        } catch (mediaErr: any) {
          console.warn('[LibraryService] Error paginando MediaLibrary:', mediaErr);
          break;
        }
      }
    }

    const resolvedAssets = await resolveScannedAssets(allAssets);

    const validAssets = resolvedAssets.filter(asset => {
      const rawName = asset.filename || asset.sourceUri || asset.uri || '';
      const cleanNameLower = decodeURIComponentSafe(rawName).toLowerCase();
      const isAudioExt = AUDIO_EXTENSIONS_REGEX.test(cleanNameLower) || ['mp3', 'flac', 'wav', 'm4a', 'aac', 'ogg', 'dsd', 'dff', 'dsf'].some(ext => cleanNameLower.endsWith(`.${ext}`)) || asset.mediaType === 'audio';
      const hasValidDuration = !asset.duration || asset.duration >= 3;
      return isAudioExt && hasValidDuration;
    });

    if (onProgress) onProgress(`Sincronizando ${validAssets.length} audios compatibles...`, 0, validAssets.length);

    const newAssetsToInsert: any[] = [];
    const activeAssetUris = new Set<string>();
    const migratedIds = new Set<string>();

    for (const asset of validAssets) {
      activeAssetUris.add(asset.uri);
      if (cachedIds.has(asset.uri)) continue;

      const sourceUri = asset.sourceUri || asset.uri;
      if (sourceUri !== asset.uri && cachedIds.has(sourceUri)) {
        const migrated = await updateTrackUri(sourceUri, asset.uri);
        if (migrated) {
          cachedIds.add(asset.uri);
          migratedIds.add(sourceUri);
          continue;
        }
      }

      newAssetsToInsert.push(asset);
    }

    if (!targetFolderUri && activeAssetUris.size > 0 && cachedTracks.length > 0) {
      const deletedIds: string[] = [];
      for (const track of cachedTracks) {
        if (!activeAssetUris.has(track.id) && !migratedIds.has(track.id)) {
          deletedIds.push(track.id);
        }
      }
      if (deletedIds.length > 0) {
        try {
          await deleteTracks(deletedIds);
        } catch (delErr) {
          console.warn('[LibraryService] Error al limpiar pistas antiguas eliminadas:', delErr);
        }
      }
    }

    if (newAssetsToInsert.length > 0) {
      const BATCH_SIZE = 50;
      
      for (let i = 0; i < newAssetsToInsert.length; i += BATCH_SIZE) {
        const batchAssets = newAssetsToInsert.slice(i, i + BATCH_SIZE);
        const batchTracks: Track[] = [];

        const currentCount = Math.min(i + batchAssets.length, newAssetsToInsert.length);
        if (onProgress) {
          onProgress(`Procesando ${currentCount} de ${newAssetsToInsert.length} canciones...`, currentCount, newAssetsToInsert.length);
        }

        for (const asset of batchAssets) {
          try {
            let meta: any = {};
            try {
              meta = await extractMetadata(asset.uri, asset.uri);
            } catch (metaErr) {
              meta = {};
            }
            
            const rawName = asset.filename || asset.uri || '';
            const cleanName = decodeURIComponentSafe(rawName).split('/').pop()?.split('%2F').pop()?.split('?')[0]?.replace(/\.[^/.]+$/, '').replace(/_/g, ' ') || 'Pista de Audio';
            
            let title = meta.title || cleanName;
            let artist = meta.artist || 'Desconocido';
            let needsRepair = false;

            if (!meta.title || !meta.artist || meta.artist.toLowerCase().includes('unknown') || artist === 'Desconocido') {
              needsRepair = true;
            }

            let artworkUri = meta.artwork_thumb;
            let thumbUri = meta.artwork_thumb;

            const linkedLyrics = await findAndLinkLyricsNative(asset);

            batchTracks.push({
              id: asset.uri,
              url: asset.uri,
              title,
              artist,
              album: meta.album || 'Carpeta de Música',
              duration: Math.round((meta as any).duration || asset.duration || 180),
              qualityBadge: getFileQualityBadge(decodeURIComponentSafe(asset.filename || asset.uri || '')),
              artwork: artworkUri,
              artwork_thumb: thumbUri,
              bpm: meta.bpm,
              key: meta.key,
              replayGainTrack: meta.replayGainTrack,
              replayGainAlbum: meta.replayGainAlbum,
              needs_repair: needsRepair as any,
              lyrics_lrc: linkedLyrics || undefined,
              lyrics: linkedLyrics || undefined,
            });
          } catch (trackErr: any) {
            // Si el procesamiento individual falla por cualquier circunstancia, creamos una pista de respaldo
            const rawName = asset.filename || asset.uri || '';
            const cleanName = decodeURIComponentSafe(rawName).split('/').pop()?.split('%2F').pop()?.split('?')[0]?.replace(/\.[^/.]+$/, '').replace(/_/g, ' ') || 'Pista de Audio';
            batchTracks.push({
              id: asset.uri,
              url: asset.uri,
              title: cleanName,
              artist: 'Desconocido',
              album: 'Carpeta de Música',
              duration: Math.round(asset.duration || 180),
              qualityBadge: getFileQualityBadge(decodeURIComponentSafe(asset.filename || asset.uri || '')),
              needs_repair: true
            });
          }
        }

        if (batchTracks.length > 0) {
          try {
            await insertTracks(batchTracks);
          } catch (batchErr: any) {
            console.warn(`[LibraryService] Error en inserción de lote, reintentando pista por pista:`, batchErr);
            for (const singleTrack of batchTracks) {
              try {
                await insertTracks([singleTrack]);
              } catch (singleErr) {
                console.warn(`[LibraryService] Pista omitida por conflicto SQL: ${singleTrack.title}`, singleErr);
              }
            }
          }
        }

        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
    }

    if (onProgress) onProgress('¡Biblioteca sincronizada exitosamente!', validAssets.length, validAssets.length);
    
    return await getCachedTracks();
  } catch (error: any) {
    console.warn("[LibraryService] Error global en scanLocalAudioFiles:", error);
    throw error;
  }
}
