import jsmediatags from 'jsmediatags';
import * as FileSystem from 'expo-file-system/legacy';
import { getAudioMetadata } from '@missingcore/audio-metadata';

export interface TrackMetadata {
  duration?: number;
  title?: string;
  artist?: string;
  album?: string;
  artwork_thumb?: string;
  bpm?: number;
  key?: string;
  replayGainTrack?: number;
  replayGainAlbum?: number;
  lyrics_lrc?: string;
  lyrics_ttml?: string;
  lyrics_plain?: string;
  lyrics_source?: 'embedded_ttml' | 'embedded_lrc' | 'embedded_plain';
}

const hasLrcTimestamps = (value: string): boolean => /\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/.test(value);

function classifyEmbeddedLyrics(rawValue: unknown): Partial<TrackMetadata> {
  const candidate = typeof rawValue === 'string'
    ? rawValue
    : (rawValue as any)?.lyrics ?? (rawValue as any)?.data ?? '';
  const lyrics = String(candidate || '').replace(/\u0000/g, '').trim();
  if (!lyrics) return {};
  if (/<tt(?:\s|>)/i.test(lyrics) || /<ttml(?:\s|>)/i.test(lyrics)) {
    return { lyrics_ttml: lyrics, lyrics_source: 'embedded_ttml' };
  }
  if (hasLrcTimestamps(lyrics)) {
    return { lyrics_lrc: lyrics, lyrics_source: 'embedded_lrc' };
  }
  return { lyrics_plain: lyrics, lyrics_source: 'embedded_plain' };
}

function decodeBase64Bytes(value: string): Uint8Array {
  const GlobalBuffer = (globalThis as any).Buffer;
  if (GlobalBuffer?.from) return new Uint8Array(GlobalBuffer.from(value, 'base64'));
  const binary = typeof atob === 'function' ? atob(value) : '';
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function decodeUtf8(bytes: Uint8Array): string {
  const GlobalBuffer = (globalThis as any).Buffer;
  if (GlobalBuffer?.from) return GlobalBuffer.from(bytes).toString('utf8');
  if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(bytes);
  let encoded = '';
  for (const byte of bytes) encoded += `%${byte.toString(16).padStart(2, '0')}`;
  try { return decodeURIComponent(encoded); } catch { return ''; }
}

async function readBytes(fileUri: string, position: number, length: number): Promise<Uint8Array> {
  const base64 = await FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.Base64,
    position,
    length,
  });
  return decodeBase64Bytes(base64);
}

async function readFlacEmbeddedLyrics(fileUri: string): Promise<Partial<TrackMetadata>> {
  if (!fileUri.split('?')[0].toLowerCase().endsWith('.flac')) return {};
  try {
    const signature = decodeUtf8(await readBytes(fileUri, 0, 4));
    if (signature !== 'fLaC') return {};
    let offset = 4;
    for (let blockIndex = 0; blockIndex < 64; blockIndex++) {
      const header = await readBytes(fileUri, offset, 4);
      if (header.length < 4) break;
      const isLast = Boolean(header[0] & 0x80);
      const blockType = header[0] & 0x7f;
      const blockLength = (header[1] << 16) | (header[2] << 8) | header[3];
      if (blockType === 4 && blockLength > 8 && blockLength <= 4 * 1024 * 1024) {
        const block = await readBytes(fileUri, offset + 4, blockLength);
        const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
        let cursor = 0;
        const vendorLength = view.getUint32(cursor, true);
        cursor += 4 + vendorLength;
        if (cursor + 4 > block.length) return {};
        const commentCount = Math.min(view.getUint32(cursor, true), 10000);
        cursor += 4;
        const comments = new Map<string, string>();
        for (let index = 0; index < commentCount && cursor + 4 <= block.length; index++) {
          const commentLength = view.getUint32(cursor, true);
          cursor += 4;
          if (commentLength < 0 || cursor + commentLength > block.length) break;
          const comment = decodeUtf8(block.subarray(cursor, cursor + commentLength));
          cursor += commentLength;
          const separator = comment.indexOf('=');
          if (separator > 0) comments.set(comment.slice(0, separator).toUpperCase(), comment.slice(separator + 1));
        }
        for (const key of ['TTML', 'LYRICS_SYNCED', 'SYNCEDLYRICS', 'LYRICS', 'UNSYNCEDLYRICS']) {
          const value = comments.get(key);
          if (value?.trim()) return classifyEmbeddedLyrics(value);
        }
        return {};
      }
      offset += 4 + blockLength;
      if (isLast) break;
    }
  } catch (error) {
    console.warn(`[MetadataService] No se pudieron leer letras Vorbis/FLAC de ${fileUri}:`, error);
  }
  return {};
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
    const baseDirectory = FileSystem.documentDirectory || FileSystem.cacheDirectory;
    if (!baseDirectory) return null;
    const coversDir = `${baseDirectory}covers/`;
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

async function extractMetadataByChunks(
  fileUri: string,
  trackId?: string,
  includeArtwork = true
): Promise<TrackMetadata> {
  const cleanUri = fileUri.split('?')[0].toLowerCase();
  if (!cleanUri.endsWith('.flac') && !cleanUri.endsWith('.mp3') && !cleanUri.endsWith('.m4a') && !cleanUri.endsWith('.mp4')) {
    return {};
  }

  const requestedFields = includeArtwork
    ? ['name', 'artist', 'album', 'artwork'] as const
    : ['name', 'artist', 'album'] as const;
  const response = await Promise.race([
    getAudioMetadata(fileUri, requestedFields),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
  ]);
  if (!response) return {};

  const tags = response.metadata;
  const metadata: TrackMetadata = {
    title: tags.name?.trim(),
    artist: tags.artist?.trim(),
    album: tags.album?.trim(),
  };
  if (includeArtwork && tags.artwork) {
    const targetId = trackId || fileUri.split('/').pop()?.split('?')[0] || fileUri;
    metadata.artwork_thumb = (await saveCoverToDisk(tags.artwork, targetId)) || undefined;
  }
  return metadata;
}

/**
 * Extrae los metadatos ID3 / Vorbis / FLAC de una pista de audio local.
 * Implementa timeout defensivo y captura total de excepciones para prevenir bloqueos o caídas (undefined is not a function).
 */
async function readJsMediaTags(
  fileUri: string,
  trackId?: string,
  includePicture = false
): Promise<TrackMetadata> {
  const readPromise = new Promise<TrackMetadata>((resolve) => {
    try {
      const Reader = (jsmediatags as any)?.Reader;
      if (!Reader) return resolve({});
      const reader = new Reader(fileUri).setTagsToRead([
        'title', 'artist', 'album', 'lyrics', 'TBPM', 'TKEY', 'TXXX', 'tmpo',
        ...(includePicture ? ['picture'] : []),
      ]);
      reader.read({
        onSuccess: async (tag: any) => {
          try {
            const tags = tag?.tags ?? {};
            const metadata: TrackMetadata = {};
            if (typeof tags.title === 'string') metadata.title = tags.title.trim();
            if (typeof tags.artist === 'string') metadata.artist = tags.artist.trim();
            if (typeof tags.album === 'string') metadata.album = tags.album.trim();

            const rawBpm = tags.TBPM?.data ?? tags.tmpo?.data ?? tags.tmpo;
            const parsedBpm = Number.parseFloat(String(rawBpm ?? ''));
            if (Number.isFinite(parsedBpm) && parsedBpm > 20 && parsedBpm < 350) metadata.bpm = parsedBpm;
            if (tags.TKEY?.data) metadata.key = String(tags.TKEY.data).trim();

            const txxxFrames = tags.TXXX ? (Array.isArray(tags.TXXX) ? tags.TXXX : [tags.TXXX]) : [];
            for (const frame of txxxFrames) {
              const description = String(frame.user_description || frame.description || '').toUpperCase();
              const numericValue = Number.parseFloat(String(frame.data ?? '').replace(/[^0-9.-]+/g, ''));
              if (!Number.isFinite(numericValue)) continue;
              if (description === 'REPLAYGAIN_TRACK_GAIN') metadata.replayGainTrack = numericValue;
              if (description === 'REPLAYGAIN_ALBUM_GAIN') metadata.replayGainAlbum = numericValue;
            }

            Object.assign(metadata, classifyEmbeddedLyrics(tags.lyrics ?? tags.USLT ?? tags['©lyr']));
            if (includePicture && tags.picture?.data) {
              const base64Data = await byteArrayToBase64NonBlocking(
                tags.picture.data,
                tags.picture.format || 'image/jpeg'
              );
              const targetId = trackId || fileUri.split('/').pop()?.split('?')[0] || fileUri;
              metadata.artwork_thumb = (await saveCoverToDisk(base64Data, targetId)) || undefined;
            }
            resolve(metadata);
          } catch (error) {
            console.warn(`[MetadataService] Error procesando etiquetas de ${fileUri}:`, error);
            resolve({});
          }
        },
        onError: () => resolve({}),
      });
    } catch (error) {
      console.warn(`[MetadataService] Lector ID3/MP4 no disponible para ${fileUri}:`, error);
      resolve({});
    }
  });
  return Promise.race([
    readPromise,
    new Promise<TrackMetadata>((resolve) => setTimeout(() => resolve({}), includePicture ? 3500 : 2200)),
  ]);
}

export const extractMetadata = async (
  fileUri: string,
  trackId?: string,
  includeArtwork = true
): Promise<TrackMetadata> => {
  try {
    const [chunkedMetadata, tagMetadata, flacLyrics] = await Promise.all([
      extractMetadataByChunks(fileUri, trackId, includeArtwork).catch(() => ({})),
      readJsMediaTags(fileUri, trackId, false),
      readFlacEmbeddedLyrics(fileUri),
    ]);
    let metadata: TrackMetadata = { ...tagMetadata, ...chunkedMetadata, ...flacLyrics };
    if (includeArtwork && !metadata.artwork_thumb) {
      const pictureFallback = await readJsMediaTags(fileUri, trackId, true);
      metadata = {
        ...pictureFallback,
        ...metadata,
        artwork_thumb: metadata.artwork_thumb || pictureFallback.artwork_thumb,
      };
    }
    return metadata;
  } catch (error) {
    console.warn(`[MetadataService] Excepcion global para ${fileUri}:`, error);
    return {};
  }
};

const extractMetadataLegacy = async (fileUri: string, trackId?: string): Promise<TrackMetadata> => {
  try {
    try {
      const chunkedMetadata = await extractMetadataByChunks(fileUri, trackId);
      if (chunkedMetadata.title || chunkedMetadata.artist || chunkedMetadata.album || chunkedMetadata.artwork_thumb) {
        return chunkedMetadata;
      }
    } catch (chunkedError) {
      console.warn(`[MetadataService] Lector por bloques no disponible para ${fileUri}:`, chunkedError);
    }

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
