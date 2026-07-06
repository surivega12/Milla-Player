import TrackPlayer, { Event } from 'react-native-track-player';

// Target de volumen interno si usamos ReplayGain (ej. -14 LUFS estándar, ajustamos en base al gain)
// Como TrackPlayer.setVolume() va de 0 a 1, mapearemos los decibelios.
// 0 dB = 1.0 (máximo). Si el gain es negativo, bajamos el volumen.
const applyReplayGain = async (track: any) => {
  if (!track) return;
  
  // Asumimos que los metadatos tienen 'replayGainTrack'
  const gain = track.replayGainTrack || track.replayGainAlbum || 0;
  
  // Fórmula simple de atenuación: volume = 10 ^ (dB / 20)
  // Si gain es 0, volume es 1. Si gain es -6, volume es ~0.5
  let targetVolume = Math.pow(10, gain / 20);
  
  // Limitar entre 0 y 1 para evitar distorsión o silencio absoluto
  targetVolume = Math.max(0.01, Math.min(1.0, targetVolume));
  
  await TrackPlayer.setVolume(targetVolume);
  console.log(`[PlaybackService] ReplayGain aplicado: ${gain}dB -> Volumen: ${targetVolume.toFixed(2)}`);
};

export async function playbackService() {
  TrackPlayer.addEventListener(Event.RemotePlay, () => {
    TrackPlayer.play();
  });

  TrackPlayer.addEventListener(Event.RemotePause, () => {
    TrackPlayer.pause();
  });

  TrackPlayer.addEventListener(Event.RemoteNext, () => {
    TrackPlayer.skipToNext().catch((err) => console.log('Error al saltar a la siguiente:', err));
  });

  TrackPlayer.addEventListener(Event.RemotePrevious, () => {
    TrackPlayer.skipToPrevious().catch((err) => console.log('Error al saltar a la anterior:', err));
  });

  TrackPlayer.addEventListener(Event.RemoteSeek, (event) => {
    TrackPlayer.seekTo(event.position);
  });

  TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, async (event) => {
    if (event.track) {
      // Aplicamos ReplayGain cada vez que la pista activa cambia
      await applyReplayGain(event.track);
    }
  });
}
