import * as MediaLibrary from 'expo-media-library/legacy';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import { Platform } from 'react-native';
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
  const cleanName = filename.trim().toLowerCase().replace(/\.[^/.]+$/, '');
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
    if (!fileUri.startsWith('file://')) {
      try {
        const info = await MediaLibrary.getAssetInfoAsync(asset.id || asset);
        if (info && info.localUri) {
          fileUri = info.localUri;
        }
      } catch (e) {}
    }

    if (fileUri && fileUri.startsWith('file://')) {
      const lastSlashIdx = fileUri.lastIndexOf('/');
      if (lastSlashIdx !== -1) {
        const dirPath = fileUri.substring(0, lastSlashIdx + 1);
        const filename = asset.filename || fileUri.substring(lastSlashIdx + 1);
        const baseName = decodeURIComponent(filename).replace(/\.[^/.]+$/, '');

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
 * Lee todos los formatos compatibles (.mp3, .flac, .wav, .m4a, .aac, .ogg, .dsd) y sus archivos de letras (.lrc/.txt).
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

        const audioFiles = files.filter(f => AUDIO_EXTENSIONS_REGEX.test(f.name) || f.type.startsWith('audio/'));
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

          // Extract metadata via jsmediatags
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
            duration: Math.round((file.size || 5000000) / 32000), // Estimación orientativa para web local
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
 * Escanea la biblioteca de audio local con procesamiento por lotes y soporte universal:
 * .mp3, .flac, .wav, .m4a, .aac, .ogg, .dsd, .dff junto con vinculación de letras .lrc/.txt.
 */
export async function scanLocalAudioFiles(
  onProgress?: (progressText: string, currentCount: number, totalCount?: number) => void
): Promise<Track[]> {
  if (Platform.OS === 'web') {
    return scanWebFolderHybrid(onProgress);
  }

  const hasPermission = await requestLibraryPermission();
  if (!hasPermission) {
    throw new Error('Permisos para acceder a la biblioteca multimedia denegados. Actívalos en Ajustes.');
  }

  if (onProgress) onProgress('Leyendo archivos de audio compatibles del dispositivo...', 0);

  // 1. Obtener canciones ya en caché desde SQLite
  const cachedTracks = await getCachedTracks();
  const cachedIds = new Set(cachedTracks.map(t => t.id));

  const dbFingerprintMap = new Map<string, Track>();
  for (const track of cachedTracks) {
    const filenameFromUrl = track.url ? track.url.split('/').pop()?.split('?')[0] : track.id.split('/').pop()?.split('?')[0];
    if (filenameFromUrl) {
      const fingerprint = getTrackFingerprint(filenameFromUrl, track.duration || 0);
      dbFingerprintMap.set(fingerprint, track);
    }
  }

  // 2. Paginación nativa para traer todos los audios del dispositivo sin desbordar memoria
  let allAssets: any[] = [];
  let hasNextPage = true;
  let afterCursor: string | undefined = undefined;

  while (hasNextPage && allAssets.length < 10000) {
    const mediaPage = await MediaLibrary.getAssetsAsync({
      mediaType: MediaLibrary.MediaType.audio,
      first: 500,
      after: afterCursor,
    });
    allAssets = allAssets.concat(mediaPage.assets);
    hasNextPage = mediaPage.hasNextPage;
    afterCursor = mediaPage.endCursor;
  }

  // Filtrar exclusivamente archivos de audio válidos por expresión regular o tipo de medio, permitiendo duraciones >= 3s
  const validAssets = allAssets.filter(asset => {
    const name = asset.filename || asset.uri || '';
    const isAudioExt = AUDIO_EXTENSIONS_REGEX.test(name) || asset.mediaType === 'audio';
    const hasValidDuration = !asset.duration || asset.duration >= 3;
    return isAudioExt && hasValidDuration;
  });

  if (onProgress) onProgress(`Analizando ${validAssets.length} archivos de audio compatibles...`, 0, validAssets.length);

  // 3. Verificación defensiva anti-duplicados y detección de archivos movidos de carpeta
  const newAssetsToInsert: any[] = [];
  const processedFingerprints = new Set<string>();
  const activeAssetUris = new Set<string>();

  for (const asset of validAssets) {
    activeAssetUris.add(asset.uri);
    const assetFingerprint = getTrackFingerprint(asset.filename || '', asset.duration);

    if (processedFingerprints.has(assetFingerprint)) {
      continue;
    }
    processedFingerprints.add(assetFingerprint);

    if (cachedIds.has(asset.uri)) {
      continue;
    }

    const existingMatch = dbFingerprintMap.get(assetFingerprint);
    if (existingMatch) {
      await updateTrackUri(existingMatch.id, asset.uri);
      activeAssetUris.add(existingMatch.id);
      cachedIds.add(asset.uri);
    } else {
      newAssetsToInsert.push(asset);
    }
  }

  // 4. Detectar y eliminar de SQLite únicamente las pistas que ya no existen ni fueron reubicadas
  const deletedIds = cachedTracks
    .filter(t => !activeAssetUris.has(t.id) && !cachedIds.has(t.id))
    .map(t => t.id);

  if (deletedIds.length > 0) {
    await deleteTracks(deletedIds);
  }

  // 5. Procesamiento transaccional en lotes para las pistas nuevas junto a vinculación de letras
  if (newAssetsToInsert.length > 0) {
    const BATCH_SIZE = 50;
    
    for (let i = 0; i < newAssetsToInsert.length; i += BATCH_SIZE) {
      const batchAssets = newAssetsToInsert.slice(i, i + BATCH_SIZE);
      const batchTracks: Track[] = [];

      const currentCount = Math.min(i + batchAssets.length, newAssetsToInsert.length);
      if (onProgress) {
        onProgress(`Escaneando ${currentCount} de ${newAssetsToInsert.length} canciones...`, currentCount, newAssetsToInsert.length);
      }

      for (const asset of batchAssets) {
        try {
          const meta = await extractMetadata(asset.uri, asset.uri);
          
          let title = meta.title || asset.filename.replace(/\.[^/.]+$/, '').replace(/_/g, ' ');
          let artist = meta.artist || 'Unknown';
          let needsRepair = false;

          if (!meta.title || !meta.artist || meta.artist.toLowerCase().includes('unknown')) {
            needsRepair = true;
          }

          let artworkUri = meta.artwork_thumb;
          let thumbUri = meta.artwork_thumb;

          // Buscar letras .lrc o .txt exactamente con el mismo nombre
          const linkedLyrics = await findAndLinkLyricsNative(asset);

          batchTracks.push({
            id: asset.uri,
            url: asset.uri,
            title,
            artist,
            album: meta.album || 'Device Music',
            duration: Math.round(asset.duration || 0),
            qualityBadge: getFileQualityBadge(asset.filename || ''),
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
        } catch (err) {
          console.warn(`[LibraryService] Error procesando archivo ${asset.filename}:`, err);
        }
      }

      if (batchTracks.length > 0) {
        await insertTracks(batchTracks);
      }

      await new Promise<void>((resolve) => setTimeout(resolve, 15));
    }
  }

  if (onProgress) onProgress('¡Sincronización finalizada!', validAssets.length, validAssets.length);
  return await getCachedTracks();
}
