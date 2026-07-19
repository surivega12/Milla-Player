/**
 * Metadata and DSP synchronization.
 *
 * Startup only asks the server for cached data. Sending local audio is an
 * explicit, sequential operation so a large library never blocks the JS thread
 * or consumes mobile data without the user asking for it.
 */
import * as FileSystem from 'expo-file-system/legacy';
import * as Network from 'expo-network';
import { Platform } from 'react-native';
import { Track } from '../components/PlayerBar';
import { getAppSetting, getTracksNeedingSync, saveAppSetting, updateTrackAnalysis } from './database-service';
import { sanitizeTrackUriForPlayback } from './library-service';

export interface SyncOptions {
  batchSize?: number;
  backendUrl?: string;
  forceOnCellular?: boolean;
}

export interface SyncResult {
  success: boolean;
  syncedCount: number;
  failedCount: number;
  reason?: string;
  errors?: string[];
}

export interface AnalysisProgress {
  current: number;
  total: number;
  trackId: string;
  title: string;
  phase: 'preparing' | 'uploading' | 'analyzing' | 'saved' | 'failed';
  uploadProgress: number;
}

export interface AnalyzeLibraryOptions extends SyncOptions {
  onProgress?: (progress: AnalysisProgress) => void;
  shouldCancel?: () => boolean;
}

type AnalysisUpdate = Parameters<typeof updateTrackAnalysis>[1];

const DEFAULT_BACKEND_URL = 'http://10.0.2.2:8000';
const CONFIGURED_BACKEND_URL = (
  process.env.EXPO_PUBLIC_MILLA_API_URL || (__DEV__ ? DEFAULT_BACKEND_URL : '')
).replace(/\/$/, '');
const BACKEND_URL_SETTING = 'backend_url';

function isPrivateHttpHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host === '10.0.2.2' || host === '::1' || host.startsWith('127.')) return true;
  const parts = host.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  if (parts[0] === 10 || (parts[0] === 192 && parts[1] === 168)) return true;
  return parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
}

function normalizeBackendUrl(value: string): string {
  const candidate = String(value || '').trim();
  if (!candidate) return '';
  try {
    const url = new URL(candidate);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return '';
    if (url.protocol === 'http:' && !isPrivateHttpHost(url.hostname)) return '';
    if (url.pathname !== '/' || url.search || url.hash) return '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

export async function getBackendUrl(override?: string): Promise<string> {
  const configured = override !== undefined
    ? override
    : (await getAppSetting(BACKEND_URL_SETTING)) || CONFIGURED_BACKEND_URL;
  return normalizeBackendUrl(configured);
}

export async function saveBackendUrl(value: string): Promise<string> {
  const raw = String(value || '').trim();
  if (!raw) {
    await saveAppSetting(BACKEND_URL_SETTING, '');
    return '';
  }
  const normalized = normalizeBackendUrl(raw);
  if (!normalized) {
    throw new Error('Usa una URL http privada de tu Wi-Fi o una URL https valida, sin ruta adicional.');
  }
  const saved = await saveAppSetting(BACKEND_URL_SETTING, normalized);
  if (!saved) throw new Error('No se pudo guardar la URL del servidor local.');
  return normalized;
}

function hasStoredLyrics(track: Track): boolean {
  return Boolean(
    String(track.lyrics_ttml || '').trim() ||
    String(track.lyrics_lrc || '').trim() ||
    String(track.lyrics_plain || '').trim() ||
    String(track.lyrics_json || '').trim() ||
    String(track.lyrics || '').trim()
  );
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number = 8000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export const checkCanSync = async (
  forceOnCellular: boolean = false
): Promise<{ canSync: boolean; reason?: string }> => {
  if (Platform.OS === 'web') return { canSync: false, reason: 'ENTORNO_WEB' };
  try {
    const networkState = await Network.getNetworkStateAsync();
    if (!networkState.isConnected) {
      return { canSync: false, reason: 'SIN_RED' };
    }
    if (networkState.type === Network.NetworkStateType.CELLULAR && !forceOnCellular) {
      return { canSync: false, reason: 'DATOS_MOVILES_DETECTADOS' };
    }
    if (
      networkState.type !== Network.NetworkStateType.WIFI &&
      networkState.type !== Network.NetworkStateType.ETHERNET &&
      !forceOnCellular
    ) {
      return { canSync: false, reason: 'NO_ES_WIFI' };
    }
    // A local Django server may be reachable on Wi-Fi even when that network
    // has no route to the public Internet. It can still serve cached lyrics
    // and perform local DSP, so do not reject the LAN solely for that reason.
    return { canSync: true };
  } catch (error) {
    console.warn('[SyncService] No se pudo consultar el tipo de red:', error);
    return { canSync: false, reason: 'RED_NO_VERIFICADA' };
  }
};

function mapLyricsResult(item: any): AnalysisUpdate {
  if (!item?.success) return {};
  const update: AnalysisUpdate = {};
  if (item.lyrics_lrc) update.lyrics_lrc = String(item.lyrics_lrc);
  if (item.lyrics_json && (typeof item.lyrics_json === 'string' || item.lyrics_json.length > 0)) {
    update.lyrics_json = typeof item.lyrics_json === 'string'
      ? item.lyrics_json
      : JSON.stringify(item.lyrics_json);
  }
  if (update.lyrics_lrc || update.lyrics_json) {
    update.lyrics_source = String(item.source || 'api');
  }
  return update;
}

/**
 * Resolves lyrics only. Unlike syncSingleTrack, this endpoint never uploads
 * the audio file or starts DSP work, so opening the microphone stays light.
 */
export async function syncLyricsForTrack(
  track: Track,
  backendUrl?: string
): Promise<AnalysisUpdate> {
  const resolvedBackendUrl = await getBackendUrl(backendUrl);
  if (!track?.id || !resolvedBackendUrl || Platform.OS === 'web') return {};
  const networkCheck = await checkCanSync(false);
  if (!networkCheck.canSync) return {};

  try {
    const response = await fetchWithTimeout(`${resolvedBackendUrl}/api/lyrics/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tracks: [{
          track_id: track.id,
          id: track.id,
          title: track.title || '',
          artist: track.artist || '',
          album: track.album || '',
          duration: track.duration || 0,
        }],
      }),
    }, 12000);
    if (!response.ok) return {};

    const payload = await response.json();
    const item = (payload?.results || [])[0] ?? payload;
    const update = mapLyricsResult(item);
    if (Object.keys(update).length > 0) {
      await updateTrackAnalysis(track.id, update);
      return update;
    }
    if (item && item.success === false) {
      await updateTrackAnalysis(track.id, { lyrics_source: 'not_found' });
    }
  } catch (error) {
    console.warn(`[SyncService] No se pudieron resolver letras para ${track.id}:`, error);
  }
  return {};
}

function mapDspResult(item: any): AnalysisUpdate {
  if (!item?.success) return {};
  const update: AnalysisUpdate = { analysis_status: 'ready' };
  const durationMs = Number(item.duration_ms);
  if (Number.isFinite(durationMs) && durationMs > 0) {
    update.duration = Math.round(durationMs) / 1000;
  }
  const numericFields: Array<keyof AnalysisUpdate> = [
    'bpm',
    'vocal_silence_start_ms',
    'vocal_silence_end_ms',
    'intro_duration_ms',
    'outro_duration_ms',
    'outro_start_ms',
    'intro_energy',
    'outro_energy',
    'beat_interval_ms',
  ];
  for (const field of numericFields) {
    if (item[field] !== undefined && item[field] !== null && Number.isFinite(Number(item[field]))) {
      (update as Record<string, unknown>)[field] = Number(item[field]);
    }
  }
  if (item.camelot_key) update.camelot_key = String(item.camelot_key);
  update.analysis_version = String(item.analysis_version || 'milla-dsp-2');
  return update;
}

function mimeTypeForUri(uri: string): string {
  const extension = uri.split('?')[0].split('.').pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    mp3: 'audio/mpeg',
    flac: 'audio/flac',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    ogg: 'audio/ogg',
    opus: 'audio/opus',
  };
  return mimeTypes[extension || ''] || 'application/octet-stream';
}

const MAX_ANALYSIS_FILE_BYTES = 750 * 1024 * 1024;

function stableTemporaryFileName(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function inferAnalysisExtension(track: Track): string {
  const rawExtension = String(track.file_extension || '').replace(/^\./, '').toLowerCase();
  if (/^(mp3|flac|wav|m4a|aac|ogg|opus|dsf|dff)$/.test(rawExtension)) return `.${rawExtension}`;
  const candidate = String(track.source_uri || track.url || '').split('?')[0];
  const extension = candidate.split('.').pop()?.toLowerCase() || '';
  if (/^(mp3|flac|wav|m4a|aac|ogg|opus|dsf|dff)$/.test(extension)) return `.${extension}`;
  const badge = String(track.qualityBadge || '').toLowerCase();
  if (badge.includes('flac')) return '.flac';
  if (badge.includes('wav')) return '.wav';
  if (badge.includes('dsd')) return '.dsf';
  if (badge.includes('aac')) return '.aac';
  if (badge.includes('ogg')) return '.ogg';
  return '.mp3';
}

async function prepareTrackForAnalysis(track: Track): Promise<{ uri: string; temporary: boolean }> {
  const directCandidates = [track.url, track.source_uri, track.id]
    .filter((value): value is string => Boolean(value));
  for (const candidate of directCandidates) {
    const fileUri = sanitizeTrackUriForPlayback(candidate);
    if (!fileUri.startsWith('file://')) continue;
    const info = await FileSystem.getInfoAsync(fileUri).catch(() => null);
    if (info?.exists && !info.isDirectory) {
      if (Number(info.size || 0) > MAX_ANALYSIS_FILE_BYTES) throw new Error('ARCHIVO_SUPERA_LIMITE_DSP');
      return { uri: fileUri, temporary: false };
    }
  }

  const sourceUri = directCandidates.find((candidate) => candidate.startsWith('content://'));
  if (!sourceUri || !FileSystem.cacheDirectory) throw new Error('RUTA_LOCAL_NO_ACCESIBLE');
  const directory = `${FileSystem.cacheDirectory}milla-analysis/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true }).catch(() => {});
  const tempUri = `${directory}${stableTemporaryFileName(`${track.id}:${sourceUri}:${Date.now()}`)}${inferAnalysisExtension(track)}`;
  await FileSystem.copyAsync({ from: sourceUri, to: tempUri });
  const copied = await FileSystem.getInfoAsync(tempUri).catch(() => null);
  if (!copied?.exists || copied.isDirectory || Number(copied.size || 0) <= 0) {
    await FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(() => {});
    throw new Error('CONTENT_COPY_FAILED');
  }
  if (Number(copied.size || 0) > MAX_ANALYSIS_FILE_BYTES) {
    await FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(() => {});
    throw new Error('ARCHIVO_SUPERA_LIMITE_DSP');
  }
  return { uri: tempUri, temporary: true };
}

export async function uploadTrackForAnalysis(
  track: Track,
  backendUrl?: string,
  onUploadProgress?: (progress: number) => void
): Promise<{ success: boolean; data?: any; reason?: string }> {
  const resolvedBackendUrl = await getBackendUrl(backendUrl);
  if (Platform.OS === 'web') return { success: false, reason: 'ENTORNO_WEB' };
  if (!resolvedBackendUrl) return { success: false, reason: 'BACKEND_NO_CONFIGURADO' };

  let prepared: { uri: string; temporary: boolean } | null = null;
  try {
    prepared = await prepareTrackForAnalysis(track);
    const task = FileSystem.createUploadTask(
      `${resolvedBackendUrl}/api/analyze/`,
      prepared.uri,
      {
        httpMethod: 'POST',
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
        fieldName: 'audio_file',
        mimeType: mimeTypeForUri(prepared.uri),
        parameters: {
          track_id: String(track.id),
          title: track.title || '',
          artist: track.artist || '',
        },
        sessionType: FileSystem.FileSystemSessionType.FOREGROUND,
      },
      ({ totalBytesExpectedToSend, totalBytesSent }) => {
        if (totalBytesExpectedToSend > 0) {
          onUploadProgress?.(Math.min(1, totalBytesSent / totalBytesExpectedToSend));
        }
      }
    );
    const response = await task.uploadAsync();
    if (!response || response.status < 200 || response.status >= 300) {
      return { success: false, reason: `HTTP_${response?.status || 0}` };
    }
    const data = JSON.parse(response.body || '{}');
    return data?.success
      ? { success: true, data }
      : { success: false, data, reason: data?.reason || 'ANALISIS_SIN_RESULTADO' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, reason: message === 'ARCHIVO_SUPERA_LIMITE_DSP' ? message : 'RUTA_LOCAL_NO_ACCESIBLE' };
  } finally {
    if (prepared?.temporary) {
      await FileSystem.deleteAsync(prepared.uri, { idempotent: true }).catch(() => {});
    }
  }
}

/** Fetches only cached metadata. It never uploads audio in the background. */
export const startBackgroundSync = async (options: SyncOptions = {}): Promise<SyncResult> => {
  const batchSize = options.batchSize ?? 15;
  const backendUrl = await getBackendUrl(options.backendUrl);
  const result: SyncResult = { success: false, syncedCount: 0, failedCount: 0, errors: [] };

  if (!backendUrl) {
    result.reason = 'BACKEND_NO_CONFIGURADO';
    return result;
  }
  const networkCheck = await checkCanSync(options.forceOnCellular ?? false);
  if (!networkCheck.canSync) {
    result.reason = networkCheck.reason;
    return result;
  }

  try {
    const pendingTracks = await getTracksNeedingSync(batchSize);
    if (pendingTracks.length === 0) {
      return { ...result, success: true, reason: 'BIBLIOTECA_AL_DIA' };
    }

    const payloadTracks = pendingTracks.map((track) => ({
      track_id: track.id,
      id: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album ?? '',
      duration: track.duration ?? 0,
    }));
    const lyricsPayloadTracks = payloadTracks.filter((_, index) => !hasStoredLyrics(pendingTracks[index]));

    const [lyricsResponse, dspResponse] = await Promise.all([
      lyricsPayloadTracks.length > 0
        ? fetchWithTimeout(`${backendUrl}/api/lyrics/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tracks: lyricsPayloadTracks }),
          }, 12000).catch(() => null)
        : Promise.resolve(null),
      fetchWithTimeout(`${backendUrl}/api/analyze/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracks: payloadTracks }),
      }, 12000).catch(() => null),
    ]);

    const lyricsById: Record<string, any> = {};
    const dspById: Record<string, any> = {};
    if (lyricsResponse?.ok) {
      const data = await lyricsResponse.json();
      for (const item of data?.results || []) if (item?.track_id) lyricsById[item.track_id] = item;
    }
    if (dspResponse?.ok) {
      const data = await dspResponse.json();
      for (const item of data?.results || []) if (item?.track_id) dspById[item.track_id] = item;
    }

    for (let index = 0; index < pendingTracks.length; index++) {
      const track = pendingTracks[index];
      const lyricsResult = lyricsById[track.id];
      const dspResult = dspById[track.id];
      const keepStoredLyrics = hasStoredLyrics(track);
      const update = {
        ...(!keepStoredLyrics ? mapLyricsResult(lyricsResult) : {}),
        ...mapDspResult(dspResult),
        ...(!keepStoredLyrics && lyricsResult && !lyricsResult.success ? { lyrics_source: 'not_found' } : {}),
        ...(!dspResult?.success && dspResult?.reason === 'AUDIO_REQUIRED'
          ? { analysis_status: 'audio_required' }
          : {}),
      };
      if (Object.keys(update).length === 0) {
        result.failedCount++;
      } else if (await updateTrackAnalysis(track.id, update)) {
        result.syncedCount++;
      } else {
        result.failedCount++;
      }
      if ((index + 1) % 4 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 8));
    }
    result.success = true;
    return result;
  } catch (error: any) {
    result.errors?.push(error?.message ?? String(error));
    return result;
  }
};

/** Synchronizes one active track and uploads it only when DSP is not cached. */
export const syncSingleTrack = async (
  track: Track,
  backendUrl?: string
): Promise<boolean> => {
  const resolvedBackendUrl = await getBackendUrl(backendUrl);
  if (!track?.id || !resolvedBackendUrl) return false;
  const networkCheck = await checkCanSync(false);
  if (!networkCheck.canSync) return false;

  try {
    const cleanUrl = resolvedBackendUrl;
    const payload = [{
      track_id: track.id,
      id: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album ?? '',
      duration: track.duration ?? 0,
    }];
    const keepStoredLyrics = hasStoredLyrics(track);
    const [lyricsResponse, dspResponse] = await Promise.all([
      !keepStoredLyrics
        ? fetchWithTimeout(`${cleanUrl}/api/lyrics/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tracks: payload }),
          }, 12000).catch(() => null)
        : Promise.resolve(null),
      fetchWithTimeout(`${cleanUrl}/api/analyze/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracks: payload }),
      }, 12000).catch(() => null),
    ]);

    let update: AnalysisUpdate = {};
    if (lyricsResponse?.ok) {
      const data = await lyricsResponse.json();
      update = { ...update, ...mapLyricsResult((data?.results || [])[0] ?? data) };
    }
    if (dspResponse?.ok) {
      const data = await dspResponse.json();
      update = { ...update, ...mapDspResult((data?.results || [])[0] ?? data) };
    }
    if (!update.analysis_status) {
      const upload = await uploadTrackForAnalysis(track, cleanUrl);
      if (upload.success) update = { ...update, ...mapDspResult(upload.data) };
    }
    return Object.keys(update).length > 0 && updateTrackAnalysis(track.id, update);
  } catch (error) {
    console.error(`[SyncService] Error sincronizando ${track.id}:`, error);
    return false;
  }
};

/** Explicit full-library DSP pass. Files are streamed sequentially over Wi-Fi. */
export const analyzeLibraryAudio = async (
  tracks: Track[],
  options: AnalyzeLibraryOptions = {}
): Promise<SyncResult> => {
  const backendUrl = await getBackendUrl(options.backendUrl);
  const result: SyncResult = { success: false, syncedCount: 0, failedCount: 0, errors: [] };
  if (!backendUrl) return { ...result, reason: 'BACKEND_NO_CONFIGURADO' };

  const networkCheck = await checkCanSync(options.forceOnCellular ?? false);
  if (!networkCheck.canSync) return { ...result, reason: networkCheck.reason };

  const pending = tracks.filter((track) =>
    track.analysis_status !== 'ready' ||
    !track.bpm ||
    !track.camelot_key ||
    !track.outro_duration_ms
  );
  if (pending.length === 0) return { ...result, success: true, reason: 'BIBLIOTECA_AL_DIA' };

  for (let index = 0; index < pending.length; index++) {
    if (options.shouldCancel?.()) return { ...result, reason: 'CANCELADO' };
    const track = pending[index];
    const baseProgress = {
      current: index + 1,
      total: pending.length,
      trackId: track.id,
      title: track.title,
    };
    options.onProgress?.({ ...baseProgress, phase: 'preparing', uploadProgress: 0 });
    try {
      const upload = await uploadTrackForAnalysis(track, backendUrl, (uploadProgress) => {
        options.onProgress?.({ ...baseProgress, phase: 'uploading', uploadProgress });
      });
      if (!upload.success) {
        result.failedCount++;
        result.errors?.push(`${track.title}: ${upload.reason || 'ERROR_DSP'}`);
        options.onProgress?.({ ...baseProgress, phase: 'failed', uploadProgress: 1 });
      } else {
        options.onProgress?.({ ...baseProgress, phase: 'analyzing', uploadProgress: 1 });
        const saved = await updateTrackAnalysis(track.id, mapDspResult(upload.data));
        if (saved) {
          result.syncedCount++;
          options.onProgress?.({ ...baseProgress, phase: 'saved', uploadProgress: 1 });
        } else {
          result.failedCount++;
          options.onProgress?.({ ...baseProgress, phase: 'failed', uploadProgress: 1 });
        }
      }
    } catch (error: any) {
      result.failedCount++;
      result.errors?.push(`${track.title}: ${error?.message || String(error)}`);
      options.onProgress?.({ ...baseProgress, phase: 'failed', uploadProgress: 1 });
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 16));
  }
  result.success = result.syncedCount > 0 || result.failedCount === 0;
  return result;
};
