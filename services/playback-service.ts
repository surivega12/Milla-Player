import TrackPlayer, { Event, RepeatMode } from './player-engine';
import { Platform } from 'react-native';
import { globalVertexQueueManager, VertexTrack } from './queue-service';
import { getCachedTrackById, saveQueueSnapshot, updateTrackPlayCount } from './database-service';
import { ensureTrackPlayableUri, isTrackPlayerCompatibleUri } from './library-service';

let fadingOutTrackId: string | null = null;
let shouldFadeInNextTrack = false;
let fadeRestoreVolume = 1;
let fadeGeneration = 0;
let fadeRequestInFlight = false;

async function toNativeTrackPayload(track: VertexTrack) {
  const url = await ensureTrackPlayableUri(track);
  if (!url || !isTrackPlayerCompatibleUri(url)) {
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
    vocal_silence_start_ms: track.vocal_silence_start_ms,
    vocal_silence_end_ms: track.vocal_silence_end_ms,
    intro_duration_ms: track.intro_duration_ms,
    outro_duration_ms: track.outro_duration_ms,
    outro_start_ms: track.outro_start_ms,
    intro_energy: track.intro_energy,
    outro_energy: track.outro_energy,
    beat_interval_ms: track.beat_interval_ms,
    analysis_status: track.analysis_status,
  };
}

// Target de volumen interno si usamos ReplayGain (ej. -14 LUFS estándar, ajustamos en base al gain)
// Como TrackPlayer.setVolume() va de 0 a 1, mapearemos los decibelios.
// 0 dB = 1.0 (máximo). Si el gain es negativo, bajamos el volumen.
const applyReplayGain = async (track: any) => {
  if (!track || Platform.OS === 'web') return;
  if (!globalVertexQueueManager.isVolumeNormalizationEnabled()) {
    await TrackPlayer.setVolume(1).catch(() => {});
    return;
  }
  
  // Asumimos que los metadatos tienen 'replayGainTrack'
  const gain = track.replayGainTrack || track.replayGainAlbum || 0;
  
  // Fórmula simple de atenuación: volume = 10 ^ (dB / 20)
  // Si gain es 0, volume es 1. Si gain es -6, volume es ~0.5
  let targetVolume = Math.pow(10, gain / 20);
  
  // Limitar entre 0.01 y 1.0 para evitar distorsión o silencio absoluto
  targetVolume = Math.max(0.01, Math.min(1.0, targetVolume));
  
  try {
    await TrackPlayer.setVolume(targetVolume);
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
    const trackPayload = await toNativeTrackPayload(nextTrack);

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
  await TrackPlayer.add([await toNativeTrackPayload(nextTrack)], activeIndex + 1);
}

async function refillSequentialQueue(): Promise<void> {
  if (globalVertexQueueManager.isAutoMixActive()) return;
  const queue = await TrackPlayer.getQueue();
  const activeIndex = await TrackPlayer.getActiveTrackIndex();
  if (activeIndex === undefined || activeIndex === null || activeIndex < 0) return;
  if (queue.length - activeIndex > 10) return;
  const lastTrack = queue[queue.length - 1];
  if (!lastTrack?.id) return;
  const existingIds = new Set(queue.map((track) => String(track.id)));
  const additions = globalVertexQueueManager.getSequentialTracksAfter(String(lastTrack.id), 1, existingIds);
  if (additions.length > 0) {
    const payloads = [] as Awaited<ReturnType<typeof toNativeTrackPayload>>[];
    for (const track of additions) payloads.push(await toNativeTrackPayload(track));
    await TrackPlayer.add(payloads);
  }
}

async function persistNativeQueue(): Promise<void> {
  const [queue, activeTrack] = await Promise.all([
    TrackPlayer.getQueue(),
    TrackPlayer.getActiveTrack().catch(() => undefined),
  ]);
  await saveQueueSnapshot(
    queue.map((track) => String(track.id)),
    activeTrack?.id ? String(activeTrack.id) : undefined
  );
}

async function trimNativeQueueHistory(maxPreviousTracks = 2): Promise<void> {
  const repeatMode = await TrackPlayer.getRepeatMode().catch(() => undefined);
  if (repeatMode === RepeatMode.Queue) return;
  const activeIndex = await TrackPlayer.getActiveTrackIndex();
  if (activeIndex === undefined || activeIndex === null || activeIndex <= maxPreviousTracks) return;
  const staleIndexes = Array.from(
    { length: activeIndex - maxPreviousTracks },
    (_, index) => index
  );
  if (staleIndexes.length > 0) await TrackPlayer.remove(staleIndexes);
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
    const autoMixActive = globalVertexQueueManager.isAutoMixActive();
    const crossOutEnabled = globalVertexQueueManager.isCrossOutEnabled();
    if (!autoMixActive || !crossOutEnabled) {
      if (fadingOutTrackId || shouldFadeInNextTrack) {
        fadeGeneration += 1;
        await TrackPlayer.setVolume(fadeRestoreVolume).catch(() => {});
        fadingOutTrackId = null;
        shouldFadeInNextTrack = false;
      }
      if (!autoMixActive) refillSequentialQueue().catch(() => {});
      return;
    }
    if (!event.duration) return;
    const remaining = event.duration - event.position;
    const transitionSeconds = globalVertexQueueManager.getTransitionSeconds();
    if (transitionSeconds <= 0) {
      if (fadingOutTrackId || shouldFadeInNextTrack) {
        fadeGeneration += 1;
        await TrackPlayer.setVolume(fadeRestoreVolume).catch(() => {});
        fadingOutTrackId = null;
        shouldFadeInNextTrack = false;
      }
      return;
    }
    if (fadingOutTrackId && remaining > transitionSeconds + 0.5) {
      fadeGeneration += 1;
      await TrackPlayer.setVolume(fadeRestoreVolume).catch(() => {});
      fadingOutTrackId = null;
      shouldFadeInNextTrack = false;
    }
    if (fadeRequestInFlight) return;
    fadeRequestInFlight = true;
    try {
      const activeTrack = await TrackPlayer.getActiveTrack().catch(() => undefined);
      const analyzedOutroSeconds = Number((activeTrack as any)?.outro_duration_ms || 0) / 1000;
      const analyzedOutroStartSeconds = Number((activeTrack as any)?.outro_start_ms || 0) / 1000;
      const fadeWindowSeconds = globalVertexQueueManager.isCrossOutEnabled() && analyzedOutroSeconds > 0
        ? Math.min(transitionSeconds, Math.max(1, analyzedOutroSeconds))
        : transitionSeconds;
      const naturalFadeStart = Math.max(0, event.duration - fadeWindowSeconds);
      const isUsefulEarlyOutro = analyzedOutroStartSeconds > 4 &&
        analyzedOutroStartSeconds < naturalFadeStart &&
        event.duration - analyzedOutroStartSeconds <= 45;
      const fadeStart = isUsefulEarlyOutro ? analyzedOutroStartSeconds : naturalFadeStart;
      if (remaining <= 0 || event.position < fadeStart) return;

      const activeId = activeTrack?.id ? String(activeTrack.id) : null;
      if (!activeId || fadingOutTrackId === activeId) return;

      fadingOutTrackId = activeId;
      shouldFadeInNextTrack = true;
      const currentFadeGeneration = ++fadeGeneration;
      const startVolume = await TrackPlayer.getVolume().catch(() => 1);
      fadeRestoreVolume = startVolume;
      const fadeDurationMs = Math.max(350, Math.min(remaining, fadeWindowSeconds) * 1000);
      const steps = Math.max(8, Math.min(40, Math.round(fadeDurationMs / 100)));
      for (let step = steps - 1; step >= 0; step--) {
        if (fadeGeneration !== currentFadeGeneration || fadingOutTrackId !== activeId) return;
        await TrackPlayer.setVolume(Math.max(0.02, startVolume * (step / steps))).catch(() => {});
        await new Promise<void>((resolve) => setTimeout(resolve, fadeDurationMs / steps));
      }

      // This engine owns one active decoder. For a DSP-confirmed long outro,
      // advance after the fade instead of leaving a silent tail.
      if (isUsefulEarlyOutro && fadeGeneration === currentFadeGeneration && fadingOutTrackId === activeId) {
        try {
          const [queue, activeIndex] = await Promise.all([
            TrackPlayer.getQueue(),
            TrackPlayer.getActiveTrackIndex(),
          ]);
          if (activeIndex !== undefined && activeIndex !== null && queue[activeIndex + 1]) {
            await TrackPlayer.skipToNext();
            await TrackPlayer.play();
          }
        } catch (error) {
          shouldFadeInNextTrack = false;
          fadingOutTrackId = null;
          await TrackPlayer.setVolume(fadeRestoreVolume).catch(() => {});
          console.warn('[PlaybackService] No se pudo avanzar tras el cross-out:', error);
        }
      }
    } finally {
      fadeRequestInFlight = false;
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
      const storedTrack = event.track.id
        ? await getCachedTrackById(String(event.track.id)).catch(() => undefined)
        : undefined;
      const activeTrack = storedTrack
        ? { ...event.track, ...storedTrack, url: event.track.url || storedTrack.url }
        : event.track;

      await trimNativeQueueHistory().catch(() => {});

      // 1. Aplicamos la normalización de volumen audiófila (ReplayGain LUFS) en tiempo real
      const currentFadeGeneration = ++fadeGeneration;
      await applyReplayGain(activeTrack);
      if (shouldFadeInNextTrack) {
        shouldFadeInNextTrack = false;
        fadingOutTrackId = null;
        const targetVolume = await TrackPlayer.getVolume().catch(() => fadeRestoreVolume);
        await TrackPlayer.setVolume(0.02).catch(() => {});
        const fadeInSteps = 12;
        for (let step = 1; step <= fadeInSteps; step++) {
          if (fadeGeneration !== currentFadeGeneration) break;
          await TrackPlayer.setVolume(Math.max(0.02, targetVolume * (step / fadeInSteps))).catch(() => {});
          await new Promise<void>((resolve) => setTimeout(resolve, 75));
        }
      }
      
      // 2. Reportamos al Maestro (VertexQueueManager) cuál es la pista que realmente está sonando
      globalVertexQueueManager.setCurrentTrack(activeTrack as VertexTrack);
      if (globalVertexQueueManager.isAutoMixActive()) {
        prepareNextAutoMixTrack().catch((error) => {
          console.warn('[PlaybackService] No se pudo preparar la siguiente mezcla:', error);
        });
      } else {
        refillSequentialQueue().catch(() => {});
      }
      persistNativeQueue().catch(() => {});
      if (event.track.id) {
        updateTrackPlayCount(String(event.track.id)).catch(() => {});
      }

      // 3. Actualizar de inmediato en la notificación y controles nativos de Android los metadatos reales de SQLite:
      // Título, Artista y el URI del thumbnail local de la carátula.
      try {
        const dbTrack = activeTrack;
        const thumbnailUri = (dbTrack as any).artwork_thumb || dbTrack.artwork || (event.track as any).artwork;

        await TrackPlayer.updateNowPlayingMetadata({
          title: dbTrack.title || 'Canción Sin Título',
          artist: dbTrack.artist || 'Artista Desconocido',
          album: dbTrack.album || 'Milla Hi-Res Library',
          artwork: thumbnailUri,
          duration: dbTrack.duration || (event.track as any).duration || 0,
        });
      } catch (metaErr) {
        console.warn('[PlaybackService] Error al actualizar metadatos nativos en Android:', metaErr);
      }
    }
  });
}
