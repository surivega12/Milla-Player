import TrackPlayer, { Event } from 'react-native-track-player';
import { Platform } from 'react-native';
import { globalVertexQueueManager, VertexTrack } from './queue-service';
import { getCachedTracks, updateTrackPlayCount } from './database-service';
import { isUnresolvedSafUri, sanitizeTrackUriForPlayback } from './library-service';

let fadingOutTrackId: string | null = null;
let shouldFadeInNextTrack = false;
let fadeRestoreVolume = 1;

function toNativeTrackPayload(track: VertexTrack) {
  const url = sanitizeTrackUriForPlayback(track.url || track.id);
  if (!url || isUnresolvedSafUri(url)) {
    throw new Error(`La ruta de "${track.title}" no es reproducible.`);
  }
  return {
    id: track.id,
    url,
    title: track.title || 'Desconocido',
    artist: track.artist || 'Unknown Artist',
    album: track.album || 'Milla Hi-Res Library',
    artwork: track.artwork_thumb || track.artwork,
    duration: track.duration || 0,
    bpm: track.bpm,
    key: track.camelot_key || track.key,
    replayGainTrack: track.replayGainTrack,
    replayGainAlbum: track.replayGainAlbum,
  };
}

// Target de volumen interno si usamos ReplayGain (ej. -14 LUFS estándar, ajustamos en base al gain)
// Como TrackPlayer.setVolume() va de 0 a 1, mapearemos los decibelios.
// 0 dB = 1.0 (máximo). Si el gain es negativo, bajamos el volumen.
const applyReplayGain = async (track: any) => {
  if (!track || Platform.OS === 'web') return;
  
  // Asumimos que los metadatos tienen 'replayGainTrack'
  const gain = track.replayGainTrack || track.replayGainAlbum || 0;
  
  // Fórmula simple de atenuación: volume = 10 ^ (dB / 20)
  // Si gain es 0, volume es 1. Si gain es -6, volume es ~0.5
  let targetVolume = Math.pow(10, gain / 20);
  
  // Limitar entre 0.01 y 1.0 para evitar distorsión o silencio absoluto
  targetVolume = Math.max(0.01, Math.min(1.0, targetVolume));
  
  try {
    await TrackPlayer.setVolume(targetVolume);
    console.log(`[PlaybackService] ReplayGain aplicado: ${gain}dB -> Volumen: ${targetVolume.toFixed(2)}`);
  } catch (err) {
    console.warn('[PlaybackService] No se pudo ajustar el volumen ReplayGain:', err);
  }
};

/**
 * Inyecta dinámicamente una pista calculada por el Maestro (VertexQueueManager)
 * en el Esclavo nativo (TrackPlayer) justo después de la pista actualmente reproducida.
 */
async function injectAndPlayTrackFromMaster(nextTrack: VertexTrack): Promise<void> {
  if (Platform.OS === 'web') {
    console.log('[PlaybackService Web Mock] Inyectando pista simulada:', nextTrack.title);
    return;
  }

  try {
    const currentQueue = await TrackPlayer.getQueue();
    const currentActiveIndex = await TrackPlayer.getActiveTrackIndex();
    
    // Si la pista siguiente en la cola nativa de TrackPlayer ya es exactamente nextTrack, simplemente saltamos a ella
    if (currentActiveIndex !== undefined && currentActiveIndex + 1 < currentQueue.length) {
      const nativeNext = currentQueue[currentActiveIndex + 1];
      if (nativeNext.id === nextTrack.id) {
        await TrackPlayer.skipToNext();
        await TrackPlayer.play();
        return;
      }
    }

    // Preparamos el payload compatible con TrackPlayer asegurando thumbnail local (artwork_thumb)
    const trackPayload = toNativeTrackPayload(nextTrack);

    if (currentActiveIndex !== undefined && currentActiveIndex >= 0) {
      // Inyectar en índice actual + 1 para mantener la consistencia del reproductor
      await TrackPlayer.add([trackPayload], currentActiveIndex + 1);
      await TrackPlayer.skip(currentActiveIndex + 1);
    } else {
      // Si el reproductor no tiene índice activo o la cola está vacía, añadir y reproducir
      await TrackPlayer.add([trackPayload]);
      const newQueue = await TrackPlayer.getQueue();
      await TrackPlayer.skip(newQueue.length - 1);
    }
    await TrackPlayer.play();
  } catch (err) {
    console.error('[PlaybackService] Error al inyectar pista desde VertexQueueManager:', err);
  }
}

async function prepareNextAutoMixTrack(): Promise<void> {
  if (!globalVertexQueueManager.isAutoMixActive()) return;
  const nextTrack = globalVertexQueueManager.peekNextTrack();
  if (!nextTrack) return;

  const activeIndex = await TrackPlayer.getActiveTrackIndex();
  if (activeIndex === undefined || activeIndex === null || activeIndex < 0) return;
  const queue = await TrackPlayer.getQueue();
  const nativeNext = queue[activeIndex + 1];

  if (nativeNext?.id === nextTrack.id) {
    const extraIndexes = queue
      .map((_, index) => index)
      .filter((index) => index > activeIndex + 1);
    if (extraIndexes.length > 0) await TrackPlayer.remove(extraIndexes);
    return;
  }

  const upcomingIndexes = queue
    .map((_, index) => index)
    .filter((index) => index > activeIndex);
  if (upcomingIndexes.length > 0) await TrackPlayer.remove(upcomingIndexes);
  await TrackPlayer.add([toNativeTrackPayload(nextTrack)], activeIndex + 1);
}

/**
 * Servicio de reproducción nativo registrado en TrackPlayer (Arquitectura Maestro-Esclavo).
 * TrackPlayer actúa como esclavo, ejecutando las órdenes y alimentando las pistas que
 * dicta el cerebro del sistema (globalVertexQueueManager).
 */
export async function playbackService() {
  if (Platform.OS === 'web') {
    console.log('[PlaybackService Web Mock] Servicio de reproducción interceptado para entorno web.');
    return;
  }

  TrackPlayer.addEventListener(Event.RemotePlay, () => {
    TrackPlayer.play().catch((err) => console.log('Error en RemotePlay:', err));
  });

  TrackPlayer.addEventListener(Event.RemotePause, () => {
    TrackPlayer.pause().catch((err) => console.log('Error en RemotePause:', err));
  });

  TrackPlayer.addEventListener(Event.RemoteNext, async () => {
    try {
      await globalVertexQueueManager.syncSettings();
      // 1. Consultar al Maestro (VertexQueueManager: Capa 1 Prioridad o Capa 2 AutoMix)
      const nextTrack = globalVertexQueueManager.getNextTrack();
      if (nextTrack) {
        console.log('[PlaybackService] RemoteNext -> Inyectando pista dinámica del Maestro:', nextTrack.title);
        await injectAndPlayTrackFromMaster(nextTrack);
      } else {
        // Fallback nativo si la cola inteligente estuviera vacía
        await TrackPlayer.skipToNext();
      }
    } catch (err) {
      console.log('[PlaybackService] Error al saltar a la siguiente pista:', err);
    }
  });

  TrackPlayer.addEventListener(Event.RemotePrevious, async () => {
    try {
      await TrackPlayer.skipToPrevious();
    } catch (err) {
      console.log('[PlaybackService] Error al saltar a la pista anterior:', err);
    }
  });

  TrackPlayer.addEventListener(Event.RemoteSeek, (event) => {
    TrackPlayer.seekTo(event.position).catch((err) => console.log('Error en RemoteSeek:', err));
  });

  TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, async (event) => {
    if (!globalVertexQueueManager.isAutoMixActive() || !event.duration) return;
    const remaining = event.duration - event.position;
    const transitionSeconds = globalVertexQueueManager.getTransitionSeconds();
    if (fadingOutTrackId && remaining > transitionSeconds + 0.5) {
      await TrackPlayer.setVolume(fadeRestoreVolume).catch(() => {});
      fadingOutTrackId = null;
      shouldFadeInNextTrack = false;
    }
    if (remaining <= 0 || remaining > transitionSeconds) return;

    const activeTrack = await TrackPlayer.getActiveTrack().catch(() => undefined);
    const activeId = activeTrack?.id ? String(activeTrack.id) : null;
    if (!activeId || fadingOutTrackId === activeId) return;

    fadingOutTrackId = activeId;
    shouldFadeInNextTrack = true;
    const startVolume = await TrackPlayer.getVolume().catch(() => 1);
    fadeRestoreVolume = startVolume;
    for (let step = 3; step >= 0; step--) {
      await TrackPlayer.setVolume(Math.max(0.02, startVolume * (step / 4))).catch(() => {});
      await new Promise<void>((resolve) => setTimeout(resolve, 90));
    }
  });

  // Interceptar fin de cola del reproductor nativo e inyectar automáticamente desde AutoMix (Capa 2)
  TrackPlayer.addEventListener(Event.PlaybackQueueEnded, async (event) => {
    try {
      await globalVertexQueueManager.syncSettings();
      console.log('[PlaybackService] PlaybackQueueEnded -> Consultando al Maestro para reproducción continua...');
      const nextTrack = globalVertexQueueManager.getNextTrack();
      if (nextTrack) {
        console.log('[PlaybackService] Inyectando pista AutoMix de forma continua:', nextTrack.title);
        await injectAndPlayTrackFromMaster(nextTrack);
      } else {
        console.log('[PlaybackService] Fin total de reproducción o Auto Mix desactivado.');
      }
    } catch (err) {
      console.error('[PlaybackService] Error procesando PlaybackQueueEnded:', err);
    }
  });

  // Interceptar cambio de pista activa en TrackPlayer y actualizar la notificación nativa desde SQLite
  TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, async (event) => {
    if (event.track) {
      // 1. Aplicamos la normalización de volumen audiófila (ReplayGain LUFS) en tiempo real
      await applyReplayGain(event.track);
      if (shouldFadeInNextTrack) {
        shouldFadeInNextTrack = false;
        fadingOutTrackId = null;
        const targetVolume = await TrackPlayer.getVolume().catch(() => 1);
        await TrackPlayer.setVolume(0.02).catch(() => {});
        for (let step = 1; step <= 5; step++) {
          await TrackPlayer.setVolume(Math.max(0.02, targetVolume * (step / 5))).catch(() => {});
          await new Promise<void>((resolve) => setTimeout(resolve, 80));
        }
      }
      
      // 2. Reportamos al Maestro (VertexQueueManager) cuál es la pista que realmente está sonando
      globalVertexQueueManager.setCurrentTrack(event.track as any);
      prepareNextAutoMixTrack().catch((error) => {
        console.warn('[PlaybackService] No se pudo preparar la siguiente mezcla:', error);
      });
      if (event.track.id) {
        updateTrackPlayCount(event.track.id).catch(() => {});
      }
      console.log('[PlaybackService] Esclavo reporta nueva pista activa al Maestro:', event.track.title);

      // 3. Actualizar de inmediato en la notificación y controles nativos de Android los metadatos reales de SQLite:
      // Título, Artista y el URI del thumbnail local de la carátula.
      try {
        const cachedTracks = await getCachedTracks();
        const dbTrack = cachedTracks.find(t => t.id === event.track?.id) || event.track;
        const thumbnailUri = (dbTrack as any).artwork_thumb || dbTrack.artwork || (event.track as any).artwork;

        await TrackPlayer.updateNowPlayingMetadata({
          title: dbTrack.title || 'Canción Sin Título',
          artist: dbTrack.artist || 'Artista Desconocido',
          album: dbTrack.album || 'Milla Hi-Res Library',
          artwork: thumbnailUri,
          duration: dbTrack.duration || (event.track as any).duration || 0,
        });
        console.log('[PlaybackService] Notificación nativa de Android actualizada desde SQLite para:', dbTrack.title);
      } catch (metaErr) {
        console.warn('[PlaybackService] Error al actualizar metadatos nativos en Android:', metaErr);
      }
    }
  });
}
