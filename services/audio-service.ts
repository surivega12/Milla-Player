import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
  RepeatMode,
} from 'react-native-track-player';
import { Platform } from 'react-native';
import { Track } from '../components/PlayerBar';
import { globalVertexQueueManager } from './queue-service';


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
      maxCacheSize: 1024 * 1024 * 5, // Búfer de caché física (5GB)
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
  await TrackPlayer.add({
    id: track.id,
    url: track.url || track.id,
    title: track.title || 'Canción Sin Título',
    artist: track.artist || 'Artista Desconocido',
    album: track.album || 'Milla Hi-Res Library',
    artwork: track.artwork_thumb || track.artwork,
    duration: track.duration || 0,
  });

  await TrackPlayer.play();
}

export async function playPlaylist(tracks: Track[], startIndex: number = 0) {
  if (Platform.OS === 'web') {
    console.log('[AudioService Web Mock] Reproduciendo playlist simulada en Web:', tracks.length, 'pistas');
    return;
  }

  await setupPlayer();
  await TrackPlayer.reset();

  const playlist = tracks.map((track) => ({
    id: track.id,
    url: track.url || track.id,
    title: track.title || 'Canción Sin Título',
    artist: track.artist || 'Artista Desconocido',
    album: track.album || 'Milla Hi-Res Library',
    artwork: track.artwork_thumb || track.artwork,
    duration: track.duration || 0,
  }));

  await TrackPlayer.add(playlist);
  if (startIndex > 0 && startIndex < playlist.length) {
    await TrackPlayer.skip(startIndex);
  }
  await TrackPlayer.play();
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

