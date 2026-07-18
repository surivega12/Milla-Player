/**
 * Punto 3.1: Worker de Sincronización en Segundo Plano (React Native / El Celular)
 * 
 * Sincroniza metadatos pesados (Letras LRC/JSON, BPM de Librosa y Tonalidad de Camelot)
 * desde el backend de Django hacia la base de datos local SQLite (`milla.db`),
 * protegiendo los datos móviles mediante comprobación estricta de Wi-Fi y lotes asíncronos que no congelan la UI.
 */
import * as Network from 'expo-network';
import { Platform } from 'react-native';
import { getTracksNeedingSync, updateTrackAnalysis } from './database-service';
import { Track } from '../components/PlayerBar';

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

// Configuración por defecto del servidor Django (se puede sobreescribir vía variables de entorno o config local)
const DEFAULT_BACKEND_URL = 'http://10.0.2.2:8000'; // IP estándar para emulador Android local o red de casa

/**
 * Comprueba si el dispositivo está conectado a una red Wi-Fi activa.
 * Si detecta conexión móvil (cellular) y no se forzó lo contrario, aborta para no gastar megas del usuario.
 */
const CONFIGURED_BACKEND_URL = (
  process.env.EXPO_PUBLIC_MILLA_API_URL || (__DEV__ ? DEFAULT_BACKEND_URL : '')
).replace(/\/$/, '');

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number = 8000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export const checkCanSync = async (forceOnCellular: boolean = false): Promise<{ canSync: boolean; reason?: string }> => {
  if (Platform.OS === 'web') return { canSync: false, reason: 'ENTORNO_WEB' };
  try {
    const networkState = await Network.getNetworkStateAsync();

    if (!networkState.isConnected || !networkState.isInternetReachable) {
      return { canSync: false, reason: 'SIN_INTERNET' };
    }

    if (networkState.type === Network.NetworkStateType.CELLULAR && !forceOnCellular) {
      console.log('[SyncService] Conexión celular detectada. Sincronización abortada para proteger datos móviles.');
      return { canSync: false, reason: 'DATOS_MOVILES_DETECTADOS' };
    }

    if (networkState.type !== Network.NetworkStateType.WIFI && !forceOnCellular && networkState.type !== Network.NetworkStateType.ETHERNET) {
      return { canSync: false, reason: 'NO_ES_WIFI' };
    }

    return { canSync: true };
  } catch (error) {
    console.warn('[SyncService] Error verificando estado de red con expo-network, permitiendo si hay conexión local:', error);
    return { canSync: true };
  }
};

/**
 * Ejecuta el ciclo de sincronización por lote (Batch) en segundo plano o al iniciar la app.
 * Utiliza pausas no bloqueantes (yielding) para mantener el refresco de 120 FPS en el hilo de UI.
 */
export const startBackgroundSync = async (options: SyncOptions = {}): Promise<SyncResult> => {
  const batchSize = options.batchSize ?? 15;
  const backendUrl = (options.backendUrl ?? CONFIGURED_BACKEND_URL).replace(/\/$/, '');
  const forceOnCellular = options.forceOnCellular ?? false;

  const result: SyncResult = {
    success: false,
    syncedCount: 0,
    failedCount: 0,
    errors: [],
  };

  if (!backendUrl) {
    result.reason = 'BACKEND_NO_CONFIGURADO';
    return result;
  }

  // 1. Verificación estricta de Wi-Fi
  const networkCheck = await checkCanSync(forceOnCellular);
  if (!networkCheck.canSync) {
    result.reason = networkCheck.reason;
    return result;
  }

  try {
    // 2. Buscar en SQLite pistas pendientes de sincronización (needs_sync == 1 o sin BPM/Letras)
    const pendingTracks: Track[] = await getTracksNeedingSync(batchSize);

    if (pendingTracks.length === 0) {
      result.success = true;
      result.reason = 'BIBLIOTECA_AL_DIA';
      return result;
    }

    console.log(`[SyncService] Iniciando sincronización por lotes para ${pendingTracks.length} pistas en Wi-Fi...`);

    // 3. Empaquetar pistas (Título, Artista, Álbum, ID) y hacer llamadas POST en lote
    const payloadTracks = pendingTracks.map(t => ({
      track_id: t.id,
      id: t.id,
      title: t.title,
      artist: t.artist,
      album: t.album ?? '',
      duration: t.duration ?? 0,
      bpm: t.bpm ?? null,
      camelot_key: t.camelot_key ?? null,
    }));

    // A. Consultar endpoint en lote para Letras (/api/lyrics/)
    let lyricsResultsMap: Record<string, any> = {};
    try {
      const lyricsResp = await fetchWithTimeout(`${backendUrl}/api/lyrics/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracks: payloadTracks }),
      });
      if (lyricsResp.ok) {
        const lyricsData = await lyricsResp.json();
        const resultsArray = lyricsData?.results ?? [];
        for (const item of resultsArray) {
          if (item?.track_id && item.success) {
            lyricsResultsMap[item.track_id] = item;
          }
        }
      }
    } catch (e) {
      console.warn('[SyncService] Advertencia en batch /api/lyrics/:', e);
    }

    // B. Consultar endpoint en lote para Análisis DSP (/api/analyze/)
    let dspResultsMap: Record<string, any> = {};
    try {
      const dspResp = await fetchWithTimeout(`${backendUrl}/api/analyze/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracks: payloadTracks }),
      });
      if (dspResp.ok) {
        const dspData = await dspResp.json();
        const dspArray = dspData?.results ?? [];
        for (const item of dspArray) {
          if (item?.track_id && item.success) {
            dspResultsMap[item.track_id] = item;
          }
        }
      }
    } catch (e) {
      console.warn('[SyncService] Advertencia en batch /api/analyze/:', e);
    }

    // 4. Iterar sobre las pistas y guardar en SQLite de forma no bloqueante (Yielding cada 4 actualizaciones)
    for (let i = 0; i < pendingTracks.length; i++) {
      const track = pendingTracks[i];
      const lyricsInfo = lyricsResultsMap[track.id];
      const dspInfo = dspResultsMap[track.id];

      const updatePayload: {
        bpm?: number | null;
        camelot_key?: string | null;
        lyrics_json?: string | null;
        lyrics_lrc?: string | null;
      } = {};

      let hasNewData = false;

      if (lyricsInfo) {
        if (lyricsInfo.lyrics_lrc !== undefined) {
          updatePayload.lyrics_lrc = lyricsInfo.lyrics_lrc;
          hasNewData = true;
        }
        if (lyricsInfo.lyrics_json !== undefined) {
          updatePayload.lyrics_json = typeof lyricsInfo.lyrics_json === 'string'
            ? lyricsInfo.lyrics_json
            : JSON.stringify(lyricsInfo.lyrics_json);
          hasNewData = true;
        }
      }

      if (dspInfo) {
        if (dspInfo.bpm !== undefined && dspInfo.bpm !== null) {
          updatePayload.bpm = Number(dspInfo.bpm);
          hasNewData = true;
        }
        if (dspInfo.camelot_key !== undefined && dspInfo.camelot_key !== null) {
          updatePayload.camelot_key = String(dspInfo.camelot_key);
          hasNewData = true;
        }
      }

      // Una respuesta vacia no debe marcar la pista como analizada ni fabricar BPM/tonalidad.
      if (!hasNewData) {
        result.failedCount++;
        continue;
      }

      const success = await updateTrackAnalysis(track.id, updatePayload);

      if (success) {
        result.syncedCount++;
      } else {
        result.failedCount++;
      }

      // Yield temporal al event loop del JS / React para evitar saltos de frames en listas de 120 FPS
      if ((i + 1) % 4 === 0) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }

    result.success = true;
    console.log(`[SyncService] Sincronización terminada: ${result.syncedCount} actualizadas, ${result.failedCount} fallidas.`);
    return result;

  } catch (error: any) {
    console.error('[SyncService] Error crítico durante startBackgroundSync:', error);
    result.errors?.push(error?.message ?? String(error));
    return result;
  }
};

/**
 * Sincroniza inmediatamente una única pista seleccionada por el usuario en NowPlayingModal o LyricsModal.
 */
export const syncSingleTrack = async (track: Track, backendUrl: string = CONFIGURED_BACKEND_URL): Promise<boolean> => {
  if (!track || !track.id || !backendUrl) return false;
  try {
    const networkCheck = await checkCanSync(true); // Permite celular en petición única explícita del usuario
    if (!networkCheck.canSync) return false;

    const payload = [{
      track_id: track.id,
      id: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album ?? '',
      duration: track.duration ?? 0,
    }];

    const cleanUrl = backendUrl.replace(/\/$/, '');
    const [lyricsResp, dspResp] = await Promise.all([
      fetchWithTimeout(`${cleanUrl}/api/lyrics/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracks: payload }),
      }).catch(() => null),
      fetchWithTimeout(`${cleanUrl}/api/analyze/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracks: payload }),
      }).catch(() => null),
    ]);

    let updateData: any = {};
    if (lyricsResp && lyricsResp.ok) {
      const data = await lyricsResp.json();
      const item = (data?.results ?? [])[0] ?? data;
      if (item?.success && item.lyrics_lrc) updateData.lyrics_lrc = item.lyrics_lrc;
      if (
        item?.success &&
        item.lyrics_json &&
        (typeof item.lyrics_json === 'string' || (Array.isArray(item.lyrics_json) && item.lyrics_json.length > 0))
      ) {
        updateData.lyrics_json = typeof item.lyrics_json === 'string' ? item.lyrics_json : JSON.stringify(item.lyrics_json);
      }
    }
    if (dspResp && dspResp.ok) {
      const data = await dspResp.json();
      const item = (data?.results ?? [])[0] ?? data;
      if (item?.success && item.bpm !== undefined) updateData.bpm = Number(item.bpm);
      if (item?.success && item.camelot_key !== undefined) updateData.camelot_key = String(item.camelot_key);
    }

    if (Object.keys(updateData).length === 0) return false;
    return await updateTrackAnalysis(track.id, updateData);
  } catch (error) {
    console.error(`[SyncService] Error en syncSingleTrack para ${track.id}:`, error);
    return false;
  }
};
