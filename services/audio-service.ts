import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
  RepeatMode,
} from 'react-native-track-player';
import { Platform } from 'react-native';
import { Track } from '../components/PlayerBar';
import { globalVertexQueueManager } from './queue-service';
import { isUnresolvedSafUri, sanitizeTrackUriForPlayback } from './library-service';
import { getQueueSnapshot, saveQueueSnapshot } from './database-service';

function toTrackPlayerTrack(track: Track) {
  const sourceUri = track.url || track.id;
  const playableUri = sanitizeTrackUriForPlayback(sourceUri);

  if (!playableUri || isUnresolvedSafUri(playableUri)) {
    throw new Error(`La pista "${track.title || track.id}" sigue usando una URI SAF no reproducible. Vuelve a escanear la carpeta.`);
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

  let isSetup = false;
  try {
    // En TrackPlayer v4/v5, getActiveTrack verifica si el reproductor ya está inicializado
    await TrackPlayer.getActiveTrack();
    isSetup = true;
  } catch (e) {
    // Inicializar el reproductor con búfer optimizado para archivos FLAC Hi-Res grandes
    await TrackPlayer.setupPlayer({
      minBuffer: 2,
      maxBuffer: 30,
      playBuffer: 0.5,
      backBuffer: 15,
      maxCacheSize: 1024 * 1024 * 50, // Caché de 50 MB para streams; los archivos locales no se duplican.
      waitForBuffer: true,
    } as any);

    // Configurar de forma estricta las 'Capability' nativas para la barra de notificaciones y pantalla de bloqueo de Android
    await TrackPlayer.updateOptions({
      android: {
        appKilledPlaybackBehavior: AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification,
        alwaysPauseOnInterruption: true,
      },
      capabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
        Capability.SeekTo,
      ],
      compactCapabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
      ],
      notificationCapabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
        Capability.SeekTo,
      ],
      progressUpdateEventInterval: 1, // Eventos de progreso cada segundo
    } as any);

    // Configurar repetición predeterminada en apagado
    await TrackPlayer.setRepeatMode(RepeatMode.Off);
    isSetup = true;
  }
  return isSetup;
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
  await TrackPlayer.add(toTrackPlayerTrack(track));

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
  let selectedTracks = tracks;
  let selectedStartIndex = safeStartIndex;

  if (tracks.length > 0 && globalVertexQueueManager.isAutoMixActive()) {
    const current = tracks[safeStartIndex];
    globalVertexQueueManager.setCurrentTrack(current);
    const next = globalVertexQueueManager.peekNextTrack();
    selectedTracks = next && next.id !== current.id ? [current, next] : [current];
    selectedStartIndex = 0;
  } else {
    const windowStart = Math.max(0, safeStartIndex - 2);
    const windowEnd = Math.min(tracks.length, safeStartIndex + 41);
    selectedTracks = tracks.slice(windowStart, windowEnd);
    selectedStartIndex = safeStartIndex - windowStart;
  }

  const playlist = selectedTracks.map(toTrackPlayerTrack);

  await TrackPlayer.reset();
  await TrackPlayer.add(playlist);
  if (selectedStartIndex > 0 && selectedStartIndex < playlist.length) {
    await TrackPlayer.skip(selectedStartIndex);
  }
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
      await TrackPlayer.add(toTrackPlayerTrack(track), destination);
    }
  } else if (existingIndex < 0) {
    await TrackPlayer.add(toTrackPlayerTrack(track));
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
  const windowStart = Math.max(0, activeIndex - 2);
  const window = restored.slice(windowStart, activeIndex + 41);
  await TrackPlayer.add(window.map(toTrackPlayerTrack));
  const localActiveIndex = activeIndex - windowStart;
  if (localActiveIndex > 0) await TrackPlayer.skip(localActiveIndex);
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
    if (next) await TrackPlayer.add(toTrackPlayerTrack(next), activeIndex + 1);
    await persistPlaybackQueue();
    return;
  }

  const catalogIndex = tracks.findIndex((track) => track.id === currentTrack.id);
  const remainingTracks = catalogIndex >= 0 ? tracks.slice(catalogIndex + 1, catalogIndex + 41) : [];
  if (remainingTracks.length > 0) {
    await TrackPlayer.add(remainingTracks.map(toTrackPlayerTrack), activeIndex + 1);
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
