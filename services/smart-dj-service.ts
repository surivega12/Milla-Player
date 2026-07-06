// services/smart-dj-service.ts
import { Track } from 'react-native-track-player';

// Función para obtener las claves compatibles según la Rueda de Camelot
export const getCompatibleKeys = (camelotKey: string): string[] => {
  if (!camelotKey || camelotKey.length < 2) return [];
  
  const isMinor = camelotKey.endsWith('A');
  const numberStr = camelotKey.slice(0, -1);
  const number = parseInt(numberStr, 10);
  
  if (isNaN(number)) return [];

  const letter = isMinor ? 'A' : 'B';
  const oppositeLetter = isMinor ? 'B' : 'A';

  const nextNumber = number === 12 ? 1 : number + 1;
  const prevNumber = number === 1 ? 12 : number - 1;

  return [
    `${number}${letter}`,         // Misma clave (ej. 8A)
    `${nextNumber}${letter}`,     // +1 hora (ej. 9A)
    `${prevNumber}${letter}`,     // -1 hora (ej. 7A)
    `${number}${oppositeLetter}`, // Relativo Mayor/Menor (ej. 8B)
  ];
};

export const generateSmartQueue = (
  currentTrack: Track,
  allTracks: Track[],
  currentBpm?: number,
  currentKey?: string
): Track[] => {
  const bpmTolerance = 5; // ± 5 BPM
  
  let compatibleTracks = allTracks.filter(track => track.id !== currentTrack.id);

  if (currentBpm) {
    // Filtrar por BPM similar si tenemos el BPM actual
    // Asumimos que los tracks podrían tener el bpm guardado en algún campo custom (ej. track.bpm)
    // En TrackPlayer, los campos custom se pueden agregar libremente.
    compatibleTracks = compatibleTracks.filter((track: any) => {
      const trackBpm = track.bpm as number | undefined;
      if (!trackBpm) return true; // Si no tiene BPM, lo dejamos como comodín o lo filtramos. Aquí lo dejamos para no vaciar la lista.
      return Math.abs(trackBpm - currentBpm) <= bpmTolerance;
    });
  }

  if (currentKey) {
    const compatibleKeys = getCompatibleKeys(currentKey);
    compatibleTracks = compatibleTracks.filter((track: any) => {
      const trackKey = track.key as string | undefined;
      if (!trackKey) return true;
      return compatibleKeys.includes(trackKey.toUpperCase());
    });
  }

  // Mezclar aleatoriamente las pistas compatibles (Fisher-Yates)
  for (let i = compatibleTracks.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [compatibleTracks[i], compatibleTracks[j]] = [compatibleTracks[j], compatibleTracks[i]];
  }

  // Devolver las siguientes 10 pistas para la cola
  return compatibleTracks.slice(0, 10);
};
