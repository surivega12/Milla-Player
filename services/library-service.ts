import * as MediaLibrary from 'expo-media-library/legacy';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import { Platform, Alert } from 'react-native';
import { Track } from '../components/PlayerBar';
import { extractMetadata } from './metadata-service';
import { getCachedTracks, insertTracks, deleteTracks, updateTrackUri, setWebMockTracks, getWebMockTracks } from './database-service';
import jsmediatags from 'jsmediatags';

export async function requestLibraryPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return true;
  const { status, canAskAgain } = await MediaLibrary.getPermissionsAsync();
  if (status === 'granted') return true;
  if (status === 'undetermined' || canAskAgain) {
    const { status: newStatus } = await MediaLibrary.requestPermissionsAsync();
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

const generateThumbnail = async (base64Image: string, trackId: string): Promise<{ original: string, thumb: string } | null> => {
  try {
    const safeId = trackId.replace(/[^a-z0-9]/gi, '_');
    const originalUri = FileSystem.documentDirectory + `${safeId}_original.jpg`;
    
    const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, '');
    await FileSystem.writeAsStringAsync(originalUri, base64Data, { encoding: FileSystem.EncodingType.Base64 });

    const result = await ImageManipulator.manipulateAsync(
      originalUri,
      [{ resize: { width: 150 } }],
      { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG }
    );

    return {
      original: originalUri,
      thumb: result.uri
    };
  } catch (error) {
    console.warn('[LibraryService] Failed to generate thumbnail:', error);
    return null;
  }
};

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

          const fileUrl = URL.createObjectURL(file);
          const badge = getFileQualityBadge(file.name);

          const tags: any = await new Promise((resolveTags) => {
            jsmediatags.read(file, {
              onSuccess: function(tag: any) {
                resolveTags(tag.tags);
              },
              onError: function(error: any) {
                resolveTags(null);
              }
            });
          });

          let base64Cover: string | undefined = undefined;
          if (tags && tags.picture) {
            const { data, format } = tags.picture;
            let base64String = "";
            for (let j = 0; j < data.length; j++) {
              base64String += String.fromCharCode(data[j]);
            }
            base64Cover = `data:${format};base64,${btoa(base64String)}`;
          }

          const trackTitle = tags?.title || cleanName.replace(/_/g, ' ');
          const trackArtist = tags?.artist || 'Unknown Artist';
          const trackAlbum = tags?.album || '';

          newWebTracks.push({
            id: `web-local-${cleanName}_${file.size}`,
            url: fileUrl,
            title: trackTitle,
            artist: trackArtist,
            album: trackAlbum,
            duration: Math.round((file.size || 5000000) / 32000),
            qualityBadge: badge,
            lyrics_lrc: lyricsText,
            lyrics: lyricsText,
            needs_repair: false,
            needs_sync: false,
            artwork: base64Cover,
            artwork_thumb: base64Cover,
          });
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

/**
 * Escáner recursivo universal de carpetas con try-catch y alertas de diagnóstico.
 */
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

    if (visitedDirs.size === 1) {
      Alert.alert("Ruta Recibida (Recursiva)", String(dirUri));
    }

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
              uri: itemUri,
              filename: decodeURIComponentSafe(rawFilename),
              mediaType: 'audio',
              duration: 180,
              size: (info as any)?.size || 0
            });
          } else {
            const info = await FileSystem.getInfoAsync(itemUri).catch(() => null);
            if (info && info.isDirectory) {
              await readDirectoryRecursivelyNative(itemUri, onProgress, collectedAssets, visitedDirs);
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
                uri: itemPath,
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

/**
 * Escanea la biblioteca local leyendo la carpeta manual elegida o MediaLibrary.
 * Fluido, silencioso y seguro contra errores undefined is not a function en metadatos.
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

    // Si se pide obligatoriamente abrir el selector, o estamos en Android y no tenemos carpeta asignada
    if (forceManualSelection || (Platform.OS === 'android' && !targetFolderUri && customFolderUri === 'SELECT_FOLDER')) {
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
    } else if (!targetFolderUri) {
      const savedUri = await getPersistedFolderUri();
      if (savedUri) {
        targetFolderUri = savedUri;
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

    const validAssets = allAssets.filter(asset => {
      const rawName = asset.filename || asset.uri || '';
      const cleanNameLower = decodeURIComponentSafe(rawName).toLowerCase();
      const isAudioExt = AUDIO_EXTENSIONS_REGEX.test(cleanNameLower) || ['mp3', 'flac', 'wav', 'm4a', 'aac', 'ogg', 'dsd', 'dff', 'dsf'].some(ext => cleanNameLower.endsWith(`.${ext}`)) || asset.mediaType === 'audio';
      const hasValidDuration = !asset.duration || asset.duration >= 3;
      return isAudioExt && hasValidDuration;
    });

    if (onProgress) onProgress(`Sincronizando ${validAssets.length} audios compatibles...`, 0, validAssets.length);

    const newAssetsToInsert: any[] = [];
    const activeAssetUris = new Set<string>();

    for (const asset of validAssets) {
      activeAssetUris.add(asset.uri);
      if (!cachedIds.has(asset.uri)) {
        newAssetsToInsert.push(asset);
      }
    }

    if (activeAssetUris.size > 0 && cachedTracks.length > 0) {
      const deletedIds: string[] = [];
      for (const track of cachedTracks) {
        if (!activeAssetUris.has(track.id)) {
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
