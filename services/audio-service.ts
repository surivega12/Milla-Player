import TrackPlayer, { RepeatMode } from './player-engine';
import { Platform } from 'react-native';
import { Track } from '../components/PlayerBar';
import { globalVertexQueueManager } from './queue-service';
import { ensureTrackPlayableUri, isTrackPlayerCompatibleUri } from './library-service';
import { getQueueSnapshot, saveQueueSnapshot } from './database-service';

let playerSetupPromise: Promise<boolean> | null = null;
let playerInitialized = false;

async function toTrackPlayerTrack(track: Track) {
  const playableUri = await ensureTrackPlayableUri(track);
  if (!playableUri || !isTrackPlayerCompatibleUri(playableUri)) {
    throw new Error(`La pista "${track.title || track.id}" no tiene una ruta local reproducible.`);
  }

  return {
    id: track.id,
    url: playableUri,
    title: track.title || 'Canción Sin Título',
    artist: track.artist || 'Artista Desconocido',
    album: track.album || 'Milla Hi-Res Library',
    artwork: track.artwork_thumb || track.artwork,
    duration: track.duration || 0,
    bpm: track.bpm,
    camelot_key: track.camelot_key || track.key,
    vocal_silence_start_ms: track.vocal_silence_start_ms,
    vocal_silence_end_ms: track.vocal_silence_end_ms,
    intro_duration_ms: track.intro_duration_ms,
    outro_duration_ms: track.outro_duration_ms,
    outro_start_ms: track.outro_start_ms,
    intro_energy: track.intro_energy,
    outro_energy: track.outro_energy,
    beat_interval_ms: track.beat_interval_ms,
  };
}

export async function setupPlayer(): Promise<boolean> {
  if (Platform.OS === 'web') {
    return true;
  }

  if (playerInitialized) return true;
  if (playerSetupPromise) return playerSetupPromise;

  playerSetupPromise = (async () => {
    await TrackPlayer.setupPlayer();
    await TrackPlayer.updateOptions({ progressUpdateEventInterval: 0.25 });
    await TrackPlayer.setRepeatMode(RepeatMode.Off);
    playerInitialized = true;
    return true;
  })().finally(() => {
    playerSetupPromise = null;
  });

  return playerSetupPromise;
}

export async function playTrack(track: Track) {
  if (Platform.OS === 'web') {
    console.log('[AudioService Web Mock] Reproduciendo pista simulada en Web:', track.title);
    return;
  }

  // Asegurarnos de que el reproductor está configurado
  await setupPlayer();
  
  // Limpiar cola actual
  await TrackPlayer.reset();

  // Agregar la pista al reproductor nativo (100% archivos locales reales)
  await TrackPlayer.add(await toTrackPlayerTrack(track));

  await TrackPlayer.play();
}

export async function playPlaylist(tracks: Track[], startIndex: number = 0) {
  if (Platform.OS === 'web') {
    console.log('[AudioService Web Mock] Reproduciendo playlist simulada en Web:', tracks.length, 'pistas');
    return;
  }

  if (tracks.length === 0) {
    throw new Error('La lista de reproduccion esta vacia.');
  }

  await setupPlayer();
  const safeStartIndex = Math.max(0, Math.min(startIndex, Math.max(tracks.length - 1, 0)));
  globalVertexQueueManager.setCatalog(tracks);
  const current = tracks[safeStartIndex];

  if (tracks.length > 0 && globalVertexQueueManager.isAutoMixActive()) {
    globalVertexQueueManager.setCurrentTrack(current);
  }

  // Do not materialize the following file before playback starts. A large FLAC
  // selected from a content:// library must not make the tap feel frozen.
  const payload = await toTrackPlayerTrack(current);

  await TrackPlayer.reset();
  await TrackPlayer.add(payload);
  await persistPlaybackQueue();
  await TrackPlayer.play();
}

export async function persistPlaybackQueue(): Promise<void> {
  if (Platform.OS === 'web') return;
  const [queue, activeTrack] = await Promise.all([
    TrackPlayer.getQueue(),
    TrackPlayer.getActiveTrack().catch(() => undefined),
  ]);
  await saveQueueSnapshot(
    queue.map((track) => String(track.id)),
    activeTrack?.id ? String(activeTrack.id) : undefined
  );
}

export async function enqueueTrack(track: Track, asNext: boolean = false): Promise<void> {
  if (globalVertexQueueManager.getCurrentTrack()?.id === track.id) return;
  if (asNext) globalVertexQueueManager.playNext(track);
  else globalVertexQueueManager.addToQueue(track);
  if (Platform.OS === 'web') return;

  await setupPlayer();
  const [queue, activeIndex] = await Promise.all([
    TrackPlayer.getQueue(),
    TrackPlayer.getActiveTrackIndex(),
  ]);
  const existingIndex = queue.findIndex((item) => String(item.id) === track.id);
  if (asNext && activeIndex !== undefined && activeIndex !== null && activeIndex >= 0) {
    if (existingIndex === activeIndex) return;
    const desiredIndex = existingIndex >= 0 && existingIndex < activeIndex ? activeIndex : activeIndex + 1;
    const destination = Math.min(desiredIndex, queue.length);
    if (existingIndex >= 0) {
      if (existingIndex !== destination) await TrackPlayer.move(existingIndex, destination);
    } else {
      await TrackPlayer.add(await toTrackPlayerTrack(track), destination);
    }
  } else if (existingIndex < 0) {
    await TrackPlayer.add(await toTrackPlayerTrack(track));
  }
  await persistPlaybackQueue();
}

export async function removeTrackFromPlaybackQueue(trackId: string): Promise<void> {
  globalVertexQueueManager.removeFromQueue(trackId);
  if (Platform.OS === 'web') return;
  const [queue, activeIndex] = await Promise.all([
    TrackPlayer.getQueue(),
    TrackPlayer.getActiveTrackIndex(),
  ]);
  const indexes = queue
    .map((track, index) => String(track.id) === trackId && index !== activeIndex ? index : -1)
    .filter((index) => index >= 0);
  if (indexes.length) await TrackPlayer.remove(indexes);
  await persistPlaybackQueue();
}

export async function restorePlaybackQueue(tracks: Track[]): Promise<void> {
  if (Platform.OS === 'web' || tracks.length === 0) return;
  await setupPlayer();
  const currentQueue = await TrackPlayer.getQueue();
  if (currentQueue.length > 0) return;

  const snapshot = await getQueueSnapshot();
  if (!snapshot?.trackIds.length) return;
  const byId = new Map(tracks.map((track) => [track.id, track]));
  const restored = snapshot.trackIds
    .map((id) => byId.get(id))
    .filter((track): track is Track => Boolean(track));
  if (restored.length === 0) return;

  const requestedIndex = snapshot.activeTrackId
    ? restored.findIndex((track) => track.id === snapshot.activeTrackId)
    : 0;
  const activeIndex = requestedIndex >= 0 ? requestedIndex : 0;
  const restoreCandidates = [
    ...restored.slice(activeIndex),
    ...restored.slice(0, activeIndex),
  ].slice(0, 3);
  let queuePayload: Awaited<ReturnType<typeof toTrackPlayerTrack>> | null = null;
  const invalidIds = new Set<string>();
  for (const track of restoreCandidates) {
    try {
      queuePayload = await toTrackPlayerTrack(track);
      break;
    } catch (error) {
      invalidIds.add(track.id);
      console.warn(`[AudioService] Se omitio una pista invalida al restaurar la cola: ${track.id}`, error);
    }
  }
  if (queuePayload) await TrackPlayer.add(queuePayload);
  if (invalidIds.size > 0) {
    const repairedIds = snapshot.trackIds.filter((id) => !invalidIds.has(id));
    await saveQueueSnapshot(repairedIds, repairedIds.includes(snapshot.activeTrackId || '') ? snapshot.activeTrackId : repairedIds[0]);
  }
}

export async function configureAutoMixQueue(
  tracks: Track[],
  currentTrack: Track | null,
  enabled: boolean
): Promise<void> {
  globalVertexQueueManager.setSessionAutoMixForced(enabled);
  globalVertexQueueManager.setCatalog(tracks);
  if (Platform.OS === 'web' || !currentTrack) return;

  const activeIndex = await TrackPlayer.getActiveTrackIndex();
  if (activeIndex === undefined || activeIndex === null || activeIndex < 0) return;
  const queue = await TrackPlayer.getQueue();
  const upcomingIndexes = queue
    .map((_, index) => index)
    .filter((index) => index > activeIndex);
  if (upcomingIndexes.length > 0) await TrackPlayer.remove(upcomingIndexes);

  if (enabled) {
    globalVertexQueueManager.setCurrentTrack(currentTrack);
    const next = globalVertexQueueManager.peekNextTrack();
    if (next) await TrackPlayer.add(await toTrackPlayerTrack(next), activeIndex + 1);
    await persistPlaybackQueue();
    return;
  }

  const catalogIndex = tracks.findIndex((track) => track.id === currentTrack.id);
  const remainingTracks = catalogIndex >= 0 ? tracks.slice(catalogIndex + 1, catalogIndex + 2) : [];
  if (remainingTracks.length > 0) {
    const payloads: Awaited<ReturnType<typeof toTrackPlayerTrack>>[] = [];
    for (const track of remainingTracks) payloads.push(await toTrackPlayerTrack(track));
    await TrackPlayer.add(payloads, activeIndex + 1);
  }
  await persistPlaybackQueue();
}

export async function clearQueue(): Promise<void> {
  if (Platform.OS === 'web') {
    console.log('[AudioService Web Mock] Limpiando cola de reproducción en Web');
    globalVertexQueueManager.clearQueue();
    return;
  }
  try {
    globalVertexQueueManager.clearQueue();
    const activeIdx = await TrackPlayer.getActiveTrackIndex();
    const queue = await TrackPlayer.getQueue();
    if (activeIdx !== undefined && activeIdx !== null && queue.length > 0) {
      // Eliminar todas las pistas futuras
      const toRemove: number[] = [];
      for (let i = queue.length - 1; i > activeIdx; i--) {
        toRemove.push(i);
      }
      if (toRemove.length > 0) {
        await TrackPlayer.remove(toRemove);
      }
    } else {
      await TrackPlayer.reset();
    }
    await persistPlaybackQueue();
  } catch (e) {
    console.warn('Error al limpiar la cola:', e);
  }
}
