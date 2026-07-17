import jsmediatags from 'jsmediatags';
import * as FileSystem from 'expo-file-system/legacy';

export interface TrackMetadata {
  title?: string;
  artist?: string;
  album?: string;
  artwork_thumb?: string;
  bpm?: number;
  key?: string;
  replayGainTrack?: number;
  replayGainAlbum?: number;
}

/**
 * Convierte un arreglo de bytes (Uint8Array o number[]) a una cadena Base64
 * de forma optimizada sin bloquear el hilo principal (Prevención de ANR a 0 FPS).
 */
async function byteArrayToBase64NonBlocking(data: number[] | Uint8Array, format: string = 'image/jpeg'): Promise<string> {
  // 1. Camino ultrarrápido: Si Buffer está disponible en el entorno nativo de React Native (JSI / Expo)
  const GlobalBuffer = (globalThis as any).Buffer;
  if (GlobalBuffer && typeof GlobalBuffer.from === 'function') {
    try {
      const base64Str = GlobalBuffer.from(data).toString('base64');
      return `data:${format};base64,${base64Str}`;
    } catch (e) {
      console.warn('[MetadataService] Buffer fallback por error en decodificación nativa:', e);
    }
  }

  // 2. Camino por trozos (Chunked TypedArray) para evitar RangeError: Maximum call stack size exceeded
  // y evitar congelamiento de UI en carátulas FLAC pesadas (> 1MB)
  const CHUNK_SIZE = 8192;
  const totalChunks = Math.ceil(data.length / CHUNK_SIZE);
  let binaryString = '';

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, data.length);
    const chunk = Array.isArray(data) ? data.slice(start, end) : data.subarray(start, end);

    // Convertir trozo en bloque sin bucle carácter por carácter
    binaryString += String.fromCharCode.apply(null, chunk as any);

    // Ceder control temporalmente al event loop cada 15 trozos (~120KB) para mantener UI a 120Hz
    if (i > 0 && i % 15 === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  if (typeof btoa === 'function') {
    return `data:${format};base64,${btoa(binaryString)}`;
  }

  // Fallback final por si btoa no está definido
  if (GlobalBuffer) {
    return `data:${format};base64,${GlobalBuffer.from(binaryString, 'binary').toString('base64')}`;
  }

  return '';
}

/**
 * Helper para guardar carátula extraída físicamente a disco local sin retener Base64 gigantes en memoria o DB (Punto 4.1)
 */
async function saveCoverToDisk(base64Image: string, trackId: string): Promise<string | null> {
  try {
    const coversDir = `${FileSystem.cacheDirectory}covers/`;
    const dirInfo = await FileSystem.getInfoAsync(coversDir);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(coversDir, { intermediates: true });
    }
    const safeId = trackId.replace(/[^a-z0-9]/gi, '_');
    const fileUri = `${coversDir}${safeId}.jpg`;
    
    // Si ya se guardó previamente, retornar al instante
    const fileInfo = await FileSystem.getInfoAsync(fileUri);
    if (fileInfo.exists) {
      return fileUri;
    }

    const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, '');
    await FileSystem.writeAsStringAsync(fileUri, base64Data, { encoding: FileSystem.EncodingType.Base64 });
    return fileUri;
  } catch (err) {
    console.warn('[MetadataService] Error al guardar carátula en disco:', err);
    return null;
  }
}

/**
 * Extrae los metadatos ID3 / Vorbis / FLAC de una pista de audio local.
 * Implementa timeout defensivo y captura total de excepciones para prevenir bloqueos o caídas (undefined is not a function).
 */
export const extractMetadata = async (fileUri: string, trackId?: string): Promise<TrackMetadata> => {
  try {
    const readPromise = new Promise<TrackMetadata>((resolve) => {
      try {
        if (!jsmediatags || typeof jsmediatags.read !== 'function') {
          resolve({});
          return;
        }

        jsmediatags.read(fileUri, {
          onSuccess: async (tag) => {
            try {
              const metadata: TrackMetadata = {};
              const tags = tag.tags;

              if (tags.title) metadata.title = tags.title.trim();
              if (tags.artist) metadata.artist = tags.artist.trim();
              if (tags.album) metadata.album = tags.album.trim();

              // Extraer carátula y guardar físicamente a disco sin retener Base64 en memoria o DB (Punto 4.1)
              if (tags.picture && tags.picture.data) {
                const { data, format } = tags.picture;
                const safeFormat = format || 'image/jpeg';
                const base64Data = await byteArrayToBase64NonBlocking(data, safeFormat);
                if (base64Data) {
                  const targetId = trackId || fileUri.split('/').pop()?.split('?')[0] || fileUri;
                  const savedUri = await saveCoverToDisk(base64Data, targetId);
                  if (savedUri) {
                    metadata.artwork_thumb = savedUri;
                  }
                }
              }

              // Parse BPM (TBPM frame en ID3v2 o Vorbis Comment)
              if (tags.TBPM?.data) {
                const parsedBpm = parseInt(String(tags.TBPM.data), 10);
                if (!isNaN(parsedBpm) && parsedBpm > 0 && parsedBpm < 350) {
                  metadata.bpm = parsedBpm;
                }
              }

              // Parse Key (TKEY frame en ID3v2 o Vorbis Comment)
              if (tags.TKEY?.data) {
                metadata.key = String(tags.TKEY.data).trim();
              }

              // Parse ReplayGain (TXXX frames en ID3v2 o RVA2/Vorbis)
              if (tags.TXXX) {
                const txxxFrames = Array.isArray(tags.TXXX) ? tags.TXXX : [tags.TXXX];
                txxxFrames.forEach((frame: any) => {
                  const desc = String(frame.user_description || '').toUpperCase();
                  if (desc === 'REPLAYGAIN_TRACK_GAIN' && frame.data) {
                    const val = parseFloat(String(frame.data).replace(/[^0-9.-]+/g, ''));
                    if (!isNaN(val)) metadata.replayGainTrack = val;
                  }
                  if (desc === 'REPLAYGAIN_ALBUM_GAIN' && frame.data) {
                    const val = parseFloat(String(frame.data).replace(/[^0-9.-]+/g, ''));
                    if (!isNaN(val)) metadata.replayGainAlbum = val;
                  }
                });
              }

              resolve(metadata);
            } catch (error) {
              console.warn(`[MetadataService] Error procesando etiquetas de ${fileUri}:`, error);
              resolve({});
            }
          },
          onError: (error) => {
            console.warn(`[MetadataService] No se pudieron leer metadatos de ${fileUri}:`, error.info || error);
            resolve({});
          },
        });
      } catch (readerError) {
        // Captura directa de 'undefined is not a function' u otros errores de instanciación en builds nativos Android (.apk)
        console.warn(`[MetadataService] Error sincrónico en jsmediatags.read para ${fileUri}:`, readerError);
        resolve({});
      }
    });

    // Timeout defensivo de 3500ms: Si jsmediatags se cuelga en un header corrupto o en IO lento, resolvemos vacío
    const timeoutPromise = new Promise<TrackMetadata>((resolve) => {
      setTimeout(() => {
        resolve({});
      }, 3500);
    });

    return await Promise.race([readPromise, timeoutPromise]);
  } catch (globalErr) {
    console.warn(`[MetadataService] Excepción global en extractMetadata para ${fileUri}:`, globalErr);
    return {};
  }
};
