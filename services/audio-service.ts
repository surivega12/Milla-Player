import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
  RepeatMode,
} from 'react-native-track-player';
import { Platform } from 'react-native';
import { Track } from '../components/PlayerBar';
import { globalVertexQueueManager } from './queue-service';
import { isUnresolvedSafUri, sanitizeTrackUriForPlayback } from './library-service';

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
      minBuffer: 15,      // Mínimo de búfer en segundos antes de reproducir
      maxBuffer: 50,      // Máximo de búfer en segundos para almacenar en caché de reproducción
      playBuffer: 5,      // Búfer requerido en segundos para reanudar después de pausa
      backBuffer: 30,     // Búfer guardado detrás para rebobinado instantáneo
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

  await setupPlayer();
  await TrackPlayer.reset();

  if (tracks.length === 0) {
    throw new Error('La lista de reproduccion esta vacia.');
  }

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
  }

  const playlist = selectedTracks.map(toTrackPlayerTrack);

  await TrackPlayer.add(playlist);
  if (selectedStartIndex > 0 && selectedStartIndex < playlist.length) {
    await TrackPlayer.skip(selectedStartIndex);
  }
  await TrackPlayer.play();
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
    return;
  }

  const catalogIndex = tracks.findIndex((track) => track.id === currentTrack.id);
  const remainingTracks = catalogIndex >= 0 ? tracks.slice(catalogIndex + 1) : [];
  if (remainingTracks.length > 0) {
    await TrackPlayer.add(remainingTracks.map(toTrackPlayerTrack), activeIndex + 1);
  }
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
  } catch (e) {
    console.warn('Error al limpiar la cola:', e);
  }
}
