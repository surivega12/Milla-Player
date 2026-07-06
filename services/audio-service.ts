import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
  RepeatMode,
} from 'react-native-track-player';
import { Track } from '../components/PlayerBar';

export async function setupPlayer(): Promise<boolean> {
  let isSetup = false;
  try {
    // Si ya está inicializado, no lanzará error
    await TrackPlayer.getCurrentTrack();
    isSetup = true;
  } catch (e) {
    // Inicializar el reproductor con búfer optimizado para archivos FLAC Hi-Res grandes
    await TrackPlayer.setupPlayer({
      waitForBuffer: true,
      minBuffer: 15,      // Mínimo de búfer en segundos antes de reproducir
      maxBuffer: 50,      // Máximo de búfer en segundos para almacenar en caché de reproducción
      playBuffer: 5,      // Búfer requerido en segundos para reanudar después de pausa
      backBuffer: 30,     // Búfer guardado detrás para rebobinado instantáneo
      maxCacheSize: 1024 * 1024 * 5, // Búfer de caché física (5GB)
    });

    await TrackPlayer.updateOptions({
      android: {
        appKilledPlaybackBehavior: AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification,
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
      ],
      progressUpdateEventInterval: 1, // Eventos de progreso cada segundo
    });

    // Configurar repetición predeterminada en apagado
    await TrackPlayer.setRepeatMode(RepeatMode.Off);
    isSetup = true;
  }
  return isSetup;
}

export async function playTrack(track: Track) {
  // Asegurarnos de que el reproductor está configurado
  await setupPlayer();
  
  // Limpiar cola actual
  await TrackPlayer.reset();

  // Agregar la pista al reproductor nativo
  await TrackPlayer.add({
    id: track.id,
    url: track.artwork?.startsWith('http') && track.id.startsWith('track-') 
      ? getDemoAudioStream(track.id) 
      : track.id, // Para archivos locales, la URI del archivo es el id/path
    title: track.title,
    artist: track.artist,
    album: track.album,
    artwork: track.artwork,
    duration: track.duration,
  });

  await TrackPlayer.play();
}

export async function playPlaylist(tracks: Track[], startIndex: number = 0) {
  await setupPlayer();
  await TrackPlayer.reset();

  const playlist = tracks.map((track) => ({
    id: track.id,
    url: track.artwork?.startsWith('http') && track.id.startsWith('track-')
      ? getDemoAudioStream(track.id)
      : track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    artwork: track.artwork,
    duration: track.duration,
  }));

  await TrackPlayer.add(playlist);
  if (startIndex > 0 && startIndex < playlist.length) {
    await TrackPlayer.skip(startIndex);
  }
  await TrackPlayer.play();
}

// Retorna streams reales de música libre para que suene audio en las pruebas remotas
function getDemoAudioStream(trackId: string): string {
  const streams: Record<string, string> = {
    'track-1': 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
    'track-2': 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
    'track-3': 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
    'track-4': 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3',
    'track-5': 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3',
    'track-6': 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3',
  };
  return streams[trackId] || 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3';
}
