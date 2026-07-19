import * as MediaLibrary from 'expo-media-library/legacy';
import * as MediaLibraryPermissions from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { Track } from '../components/PlayerBar';
import { extractMetadata } from './metadata-service';
import { getCachedTracks, insertTracks, updateTrackPlaybackUri, updateTrackUri, setWebMockTracks } from './database-service';
import jsmediatags from 'jsmediatags';

let libraryPermissionRequest: Promise<boolean> | null = null;

function isAudioPermissionGranted(response: { status?: string }): boolean {
  return response?.status === 'granted';
}

export async function getLibraryPermissionStatus(): Promise<boolean> {
  if (Platform.OS === 'web') return true;
  try {
    const response = await MediaLibraryPermissions.getPermissionsAsync(false, ['audio']);
    return isAudioPermissionGranted(response);
  } catch (error) {
    console.warn('[LibraryService] No se pudo consultar el permiso de audio:', error);
    return false;
  }
}

export async function requestLibraryPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return true;
  if (libraryPermissionRequest) return libraryPermissionRequest;

  libraryPermissionRequest = (async () => {
    try {
      const current = await MediaLibraryPermissions.getPermissionsAsync(false, ['audio']);
      if (isAudioPermissionGranted(current)) return true;
      if (current.status !== 'undetermined' && current.canAskAgain === false) return false;

      const requested = await MediaLibraryPermissions.requestPermissionsAsync(false, ['audio']);
      return isAudioPermissionGranted(requested);
    } catch (error) {
      console.warn('[LibraryService] No se pudo solicitar el permiso de audio:', error);
      return false;
    } finally {
      libraryPermissionRequest = null;
    }
  })();

  return libraryPermissionRequest;
}

const AUDIO_EXTENSIONS = ['mp3', 'flac', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'dsd', 'dff', 'dsf'] as const;
const AUDIO_EXTENSIONS_REGEX = new RegExp(`\\.(${AUDIO_EXTENSIONS.join('|')})$`, 'i');
const PLAYBACK_CACHE_DIR_NAME = 'milla-playback/';
const PLAYBACK_CACHE_MAX_FILES = 12;
const PLAYBACK_CACHE_MAX_BYTES = 512 * 1024 * 1024;
const materializationPromises = new Map<string, Promise<string>>();
const playbackCacheLastUsed = new Map<string, number>();

function getFileQualityBadge(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (ext === 'flac') return 'FLAC Lossless';
  if (ext === 'wav') return 'WAV Lossless';
  if (ext === 'dsf' || ext === 'dff' || ext === 'dsd') return 'DSD Direct';
  if (ext === 'm4a' || ext === 'aac') return 'AAC Audio';
  if (ext === 'ogg' || ext === 'opus') return ext === 'opus' ? 'Opus Audio' : 'OGG Vorbis';
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

export function isContentUri(uri: string): boolean {
  return decodeURIComponentSafe(uri).startsWith('content://');
}

export function isTrackPlayerCompatibleUri(uri: string): boolean {
  const normalized = sanitizeTrackUriForPlayback(uri);
  return normalized.startsWith('file://') || /^https?:\/\//i.test(normalized);
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

function stableUriHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function inferAudioExtension(track: Pick<Track, 'file_extension' | 'qualityBadge' | 'url' | 'source_uri' | 'id'>): string {
  const candidates = [track.file_extension, track.source_uri, track.url, track.id]
    .filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    const decoded = decodeURIComponentSafe(candidate).split('?')[0];
    const extension = decoded.split('.').pop()?.toLowerCase() || '';
    if ((AUDIO_EXTENSIONS as readonly string[]).includes(extension)) return `.${extension}`;
  }
  const badge = String(track.qualityBadge || '').toLowerCase();
  if (badge.includes('flac')) return '.flac';
  if (badge.includes('wav')) return '.wav';
  if (badge.includes('dsd')) return '.dsf';
  if (badge.includes('aac')) return '.aac';
  if (badge.includes('ogg')) return '.ogg';
  return '.audio';
}

function getTrackUriCandidates(track: Pick<Track, 'id' | 'url' | 'source_uri'>): string[] {
  return [track.url, track.source_uri, track.id]
    .filter((uri): uri is string => Boolean(uri && uri.trim()))
    .filter((uri, index, values) => values.indexOf(uri) === index);
}

async function existingLocalFileUri(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    const normalized = sanitizeTrackUriForPlayback(candidate);
    if (!normalized.startsWith('file://')) continue;
    const info = await FileSystem.getInfoAsync(normalized).catch(() => null);
    if (info?.exists && !info.isDirectory) {
      if (normalized.includes(`/${PLAYBACK_CACHE_DIR_NAME}`)) {
        playbackCacheLastUsed.set(normalized, Date.now());
      }
      return normalized;
    }
  }
  return null;
}

async function prunePlaybackCache(preserveUri: string): Promise<void> {
  const cacheDirectory = FileSystem.cacheDirectory;
  if (!cacheDirectory) return;
  const cacheDir = `${cacheDirectory}${PLAYBACK_CACHE_DIR_NAME}`;
  const files = await FileSystem.readDirectoryAsync(cacheDir).catch(() => [] as string[]);
  const entries = await Promise.all(files.map(async (name) => {
    const uri = `${cacheDir}${name}`;
    const info = await FileSystem.getInfoAsync(uri).catch(() => null);
    if (!info?.exists || info.isDirectory) return null;
    return {
      uri,
      size: Number(info.size || 0),
      usedAt: playbackCacheLastUsed.get(uri) || Number(info.modificationTime || 0) * 1000,
    };
  }));
  const cacheEntries = entries.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  let totalBytes = cacheEntries.reduce((total, entry) => total + entry.size, 0);
  let totalFiles = cacheEntries.length;
  if (totalFiles <= PLAYBACK_CACHE_MAX_FILES && totalBytes <= PLAYBACK_CACHE_MAX_BYTES) return;

  const protectedUris = new Set(
    cacheEntries
      .sort((a, b) => b.usedAt - a.usedAt)
      .slice(0, 3)
      .map((entry) => entry.uri)
  );
  protectedUris.add(preserveUri);

  for (const entry of [...cacheEntries].sort((a, b) => a.usedAt - b.usedAt)) {
    if (totalFiles <= PLAYBACK_CACHE_MAX_FILES && totalBytes <= PLAYBACK_CACHE_MAX_BYTES) break;
    if (protectedUris.has(entry.uri)) continue;
    await FileSystem.deleteAsync(entry.uri, { idempotent: true }).catch(() => {});
    playbackCacheLastUsed.delete(entry.uri);
    totalFiles -= 1;
    totalBytes -= entry.size;
  }
}

async function materializeContentUri(
  sourceUri: string,
  extension: string
): Promise<string> {
  const cacheDirectory = FileSystem.cacheDirectory;
  if (!cacheDirectory) throw new Error('CACHE_DIRECTORY_UNAVAILABLE');
  const cacheDir = `${cacheDirectory}${PLAYBACK_CACHE_DIR_NAME}`;
  await FileSystem.makeDirectoryAsync(cacheDir, { intermediates: true }).catch(() => {});
  const targetUri = `${cacheDir}${stableUriHash(sourceUri)}${extension}`;
  const cached = await FileSystem.getInfoAsync(targetUri).catch(() => null);
  if (cached?.exists && !cached.isDirectory && Number(cached.size || 0) > 0) {
    playbackCacheLastUsed.set(targetUri, Date.now());
    return targetUri;
  }

  await FileSystem.copyAsync({ from: sourceUri, to: targetUri });
  const copied = await FileSystem.getInfoAsync(targetUri).catch(() => null);
  if (!copied?.exists || copied.isDirectory || Number(copied.size || 0) <= 0) {
    throw new Error('CONTENT_COPY_FAILED');
  }
  playbackCacheLastUsed.set(targetUri, Date.now());
  void prunePlaybackCache(targetUri);
  return targetUri;
}

/**
 * ExoPlayer and metadata readers receive only a real file:// URI for local
 * Android content. Source content URIs remain in SQLite for cache recovery.
 */
export async function ensureTrackPlayableUri(
  track: Pick<Track, 'id' | 'url' | 'source_uri' | 'file_extension' | 'qualityBadge'>
): Promise<string> {
  const candidates = getTrackUriCandidates(track);
  const localUri = await existingLocalFileUri(candidates);
  if (localUri) return localUri;

  const remoteUri = candidates.find((uri) => /^https?:\/\//i.test(uri));
  if (remoteUri) return remoteUri;

  const sourceUri = candidates.find((uri) => isContentUri(uri));
  if (!sourceUri) {
    throw new Error('RUTA_LOCAL_NO_ACCESIBLE');
  }

  const key = sourceUri;
  const existing = materializationPromises.get(key);
  if (existing) return existing;

  const promise = materializeContentUri(sourceUri, inferAudioExtension(track))
    .then(async (fileUri) => {
      await updateTrackPlaybackUri(track.id, fileUri, sourceUri).catch(() => false);
      return fileUri;
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`No se pudo preparar el archivo local para reproducirlo (${message}).`);
    })
    .finally(() => {
      materializationPromises.delete(key);
    });
  materializationPromises.set(key, promise);
  return promise;
}

function getFilenameFromUri(uri: string): string {
  const withoutQuery = decodeURIComponentSafe(uri).split('?')[0];
  return withoutQuery.split('/').filter(Boolean).pop() || '';
}

function getSafParentDirectoryUri(fileUri: string): string | null {
  const withoutQuery = String(fileUri || '').split('?')[0];
  const marker = '/document/';
  const markerIndex = withoutQuery.indexOf(marker);
  if (markerIndex < 0 || !withoutQuery.startsWith(SAF_EXTERNAL_STORAGE_PREFIX)) return null;

  const documentId = decodeURIComponentSafe(withoutQuery.slice(markerIndex + marker.length));
  const separator = documentId.lastIndexOf('/');
  if (separator <= 0) return null;
  const parentDocumentId = documentId.slice(0, separator);
  return `${withoutQuery.slice(0, markerIndex + marker.length)}${encodeURIComponent(parentDocumentId)}`;
}

async function readLyricsSidecar(uri: string): Promise<string | null> {
  const info = await FileSystem.getInfoAsync(uri).catch(() => null);
  if (!info?.exists || info.isDirectory) return null;
  const content = await FileSystem.readAsStringAsync(info.uri || uri, { encoding: FileSystem.EncodingType.UTF8 });
  return content?.trim() || null;
}

async function findSafLyricsSidecar(fileUri: string, baseName: string): Promise<string | null> {
  if (Platform.OS !== 'android') return null;
  const parentUri = getSafParentDirectoryUri(fileUri);
  if (!parentUri) return null;
  const items = await FileSystem.StorageAccessFramework.readDirectoryAsync(parentUri).catch(() => [] as string[]);
  const normalizedBaseName = baseName.toLocaleLowerCase('es');
  for (const itemUri of items) {
    const itemName = getFilenameFromUri(itemUri);
    const extension = itemName.split('.').pop()?.toLocaleLowerCase('es');
    const itemBaseName = itemName.replace(/\.[^/.]+$/, '').toLocaleLowerCase('es');
    if ((extension === 'lrc' || extension === 'txt') && itemBaseName === normalizedBaseName) {
      const content = await readLyricsSidecar(itemUri).catch(() => null);
      if (content) return content;
    }
  }
  return null;
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
      const filename = asset.filename || getFilenameFromUri(fileUri);
      const baseName = decodeURIComponentSafe(filename).replace(/\.[^/.]+$/, '');
      if (fileUri.startsWith('content://')) {
        const content = await findSafLyricsSidecar(fileUri, baseName);
        if (content) return content;
        return null;
      }
      const lastSlashIdx = fileUri.lastIndexOf('/');
      if (lastSlashIdx !== -1) {
        const dirPath = fileUri.substring(0, lastSlashIdx + 1);

        // 1. Verificar archivo con extensión .lrc
        const lrcPathEncoded = `${dirPath}${encodeURIComponent(baseName)}.lrc`;
        const lrcPathRaw = `${dirPath}${baseName}.lrc`;
        const lrcInfo = await FileSystem.getInfoAsync(lrcPathRaw).catch(() => null) || await FileSystem.getInfoAsync(lrcPathEncoded).catch(() => null);
        if (lrcInfo && lrcInfo.exists && !lrcInfo.isDirectory) {
          const content = await FileSystem.readAsStringAsync(lrcInfo.uri || lrcPathRaw, { encoding: FileSystem.EncodingType.UTF8 });
          if (content && content.trim().length > 0) {
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

export async function findCompanionLyricsForTrack(
  track: Pick<Track, 'id' | 'url' | 'source_uri'>
): Promise<string | null> {
  const sourceUri = track.source_uri || track.url || track.id;
  if (!sourceUri) return null;
  return findAndLinkLyricsNative({
    id: track.id,
    uri: sourceUri,
    sourceUri,
    filename: decodeURIComponentSafe(sourceUri).split('?')[0].split('/').pop(),
  });
}

/**
 * Hydrates only the file the listener actually opens. Full metadata extraction
 * is deliberately not performed while a 900+ item library is rendering.
 */
export async function hydrateTrackMetadataForPlayback(track: Track): Promise<Track> {
  if (Platform.OS === 'web' || !track?.id || String(track.url || '').startsWith('http')) {
    return track;
  }

  const playbackUri = await ensureTrackPlayableUri(track);
  if (!playbackUri.startsWith('file://')) return { ...track, url: playbackUri };

  const metadata = await extractMetadata(playbackUri, track.id, true);
  const companionLyrics = metadata.lyrics_ttml || metadata.lyrics_lrc || metadata.lyrics_plain
    ? null
    : await findCompanionLyricsForTrack(track);
  const title = metadata.title?.trim() || track.title;
  const artist = metadata.artist?.trim() || track.artist;
  const hydrated: Track = {
    ...track,
    url: playbackUri,
    source_uri: track.source_uri || (isContentUri(String(track.url || '')) ? track.url : undefined),
    title,
    artist,
    album: metadata.album?.trim() || track.album,
    duration: Math.round(metadata.duration || track.duration || 0),
    artwork: metadata.artwork_thumb || track.artwork,
    artwork_thumb: metadata.artwork_thumb || track.artwork_thumb,
    bpm: metadata.bpm ?? track.bpm,
    key: metadata.key || track.key,
    genre: metadata.genre || track.genre,
    replayGainTrack: metadata.replayGainTrack ?? track.replayGainTrack,
    replayGainAlbum: metadata.replayGainAlbum ?? track.replayGainAlbum,
    lyrics_ttml: metadata.lyrics_ttml || track.lyrics_ttml,
    lyrics_lrc: metadata.lyrics_lrc || companionLyrics || track.lyrics_lrc || track.lyrics,
    lyrics_plain: metadata.lyrics_plain || track.lyrics_plain,
    lyrics_source: metadata.lyrics_source || (companionLyrics ? 'companion_lrc' : track.lyrics_source),
    needs_repair: metadata.title && metadata.artist ? false : track.needs_repair,
  };

  const changed = hydrated.url !== track.url ||
    hydrated.title !== track.title ||
    hydrated.artist !== track.artist ||
    hydrated.album !== track.album ||
    hydrated.artwork_thumb !== track.artwork_thumb ||
    hydrated.lyrics_ttml !== track.lyrics_ttml ||
    hydrated.lyrics_lrc !== track.lyrics_lrc ||
    hydrated.lyrics_plain !== track.lyrics_plain ||
    hydrated.genre !== track.genre ||
    hydrated.bpm !== track.bpm ||
    hydrated.key !== track.key;

  if (changed) await insertTracks([hydrated]);
  return hydrated;
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

          const isAudioExt = (AUDIO_EXTENSIONS as readonly string[]).includes(ext);
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
            const isAudioExt = (AUDIO_EXTENSIONS as readonly string[]).includes(ext);
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

async function resolveScannedAssets(allAssets: any[]): Promise<any[]> {
  // Resolving every MediaLibrary item with getAssetInfoAsync blocks navigation on
  // large libraries. Keep the stable source URI now and materialize only a track
  // that is actually played, opened for lyrics, or explicitly optimized.
  return allAssets.map((asset) => {
    const sourceUri = asset?.sourceUri || asset?.uri || asset?.id || '';
    return {
      ...asset,
      sourceUri,
      uri: sanitizeTrackUriForPlayback(asset?.localUri || sourceUri),
    };
  });
}

export async function scanDeviceAudioFiles(
  onProgress?: (progressText: string, currentCount: number, totalCount?: number) => void
): Promise<Track[]> {
  return scanLocalAudioFiles(onProgress);
}

export async function refreshLocalTrackMetadata(
  onProgress?: (current: number, total: number, title: string) => void
): Promise<{ updated: number; failed: number; total: number }> {
  if (Platform.OS === 'web') return { updated: 0, failed: 0, total: 0 };
  const tracks = await getCachedTracks();
  const localTracks = tracks.filter((track) => !String(track.url || '').startsWith('http'));
  let updated = 0;
  let failed = 0;
  let pendingBatch: Track[] = [];

  for (let index = 0; index < localTracks.length; index++) {
    const track = localTracks[index];
    onProgress?.(index + 1, localTracks.length, track.title);
    try {
      const uri = await ensureTrackPlayableUri(track);
      if (!uri || !uri.startsWith('file://')) throw new Error('URI_NOT_READABLE');
      const metadata = await extractMetadata(uri, track.id);
      const companionLyrics = metadata.lyrics_ttml || metadata.lyrics_lrc || metadata.lyrics_plain
        ? null
        : await findCompanionLyricsForTrack(track);
      const title = metadata.title || track.title;
      const artist = metadata.artist || track.artist;
      pendingBatch.push({
        ...track,
        url: uri,
        source_uri: track.source_uri || track.url || track.id,
        title,
        artist,
        album: metadata.album || track.album,
        duration: Math.round(metadata.duration || track.duration || 0),
        artwork: metadata.artwork_thumb || track.artwork,
        artwork_thumb: metadata.artwork_thumb || track.artwork_thumb,
        bpm: metadata.bpm ?? track.bpm,
        key: metadata.key || track.key,
        genre: metadata.genre || track.genre,
        replayGainTrack: metadata.replayGainTrack ?? track.replayGainTrack,
        replayGainAlbum: metadata.replayGainAlbum ?? track.replayGainAlbum,
        lyrics_ttml: metadata.lyrics_ttml || track.lyrics_ttml,
        lyrics_lrc: metadata.lyrics_lrc || companionLyrics || track.lyrics_lrc,
        lyrics_plain: metadata.lyrics_plain || track.lyrics_plain,
        lyrics_source: metadata.lyrics_source || (companionLyrics ? 'companion_lrc' : track.lyrics_source),
        needs_repair: !title || !artist || /unknown|desconocido/i.test(artist),
      });
      updated++;
    } catch {
      failed++;
    }

    if (pendingBatch.length >= 8 || index === localTracks.length - 1) {
      if (pendingBatch.length) await insertTracks(pendingBatch);
      pendingBatch = [];
      await new Promise<void>((resolve) => setTimeout(resolve, 16));
    }
  }
  return { updated, failed, total: localTracks.length };
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
    const cachedUris = new Set(
      cachedTracks.flatMap((track) => [track.url, track.source_uri]).filter((uri): uri is string => Boolean(uri))
    );

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
      const isAudioExt = AUDIO_EXTENSIONS_REGEX.test(cleanNameLower) || (AUDIO_EXTENSIONS as readonly string[]).some(ext => cleanNameLower.endsWith(`.${ext}`)) || asset.mediaType === 'audio';
      const hasValidDuration = !asset.duration || asset.duration >= 3;
      return isAudioExt && hasValidDuration;
    });

    if (onProgress) onProgress(`Sincronizando ${validAssets.length} audios compatibles...`, 0, validAssets.length);

    const newAssetsToInsert: any[] = [];

    for (const asset of validAssets) {
      const sourceUri = asset.sourceUri || asset.uri || asset.id || '';
      const canonicalId = String(asset.id || sourceUri || asset.uri);
      if (cachedIds.has(canonicalId) || cachedUris.has(sourceUri) || cachedUris.has(asset.uri)) continue;

      if (sourceUri !== asset.uri && cachedIds.has(sourceUri)) {
        const migrated = await updateTrackUri(sourceUri, asset.uri);
        if (migrated) {
          cachedIds.add(asset.uri);
          continue;
        }
      }

      newAssetsToInsert.push({ ...asset, sourceUri, canonicalId });
    }

    // MediaStore can return only a partial view of storage on Android (for
    // example after a SAF grant or while the provider is indexing). A scan is
    // additive by design; it must never erase a persisted local track merely
    // because this particular provider did not return it today.

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
            const rawName = asset.filename || asset.sourceUri || asset.uri || '';
            const cleanName = decodeURIComponentSafe(rawName).split('/').pop()?.split('%2F').pop()?.split('?')[0]?.replace(/\.[^/.]+$/, '').replace(/_/g, ' ') || 'Pista de Audio';
            
            const extension = rawName.split('?')[0].split('.').pop()?.toLowerCase() || '';
            const sourceUri = asset.sourceUri || asset.uri;
            const playableUri = sanitizeTrackUriForPlayback(asset.uri || sourceUri);

            batchTracks.push({
              id: asset.canonicalId || sourceUri,
              url: playableUri || sourceUri,
              source_uri: sourceUri,
              file_extension: extension,
              title: cleanName,
              artist: 'Desconocido',
              album: 'Carpeta de Musica',
              duration: Math.round(asset.duration || 180),
              qualityBadge: getFileQualityBadge(decodeURIComponentSafe(asset.filename || asset.sourceUri || asset.uri || '')),
              needs_repair: true,
              analysis_status: 'pending',
            });
          } catch (trackErr: any) {
            // Si el procesamiento individual falla por cualquier circunstancia, creamos una pista de respaldo
            const rawName = asset.filename || asset.uri || '';
            const cleanName = decodeURIComponentSafe(rawName).split('/').pop()?.split('%2F').pop()?.split('?')[0]?.replace(/\.[^/.]+$/, '').replace(/_/g, ' ') || 'Pista de Audio';
            batchTracks.push({
              id: asset.canonicalId || asset.sourceUri || asset.uri,
              url: sanitizeTrackUriForPlayback(asset.uri || asset.sourceUri),
              source_uri: asset.sourceUri || asset.uri,
              file_extension: (asset.filename || asset.sourceUri || asset.uri || '').split('?')[0].split('.').pop()?.toLowerCase(),
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
