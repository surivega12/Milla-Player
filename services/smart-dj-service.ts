// services/smart-dj-service.ts
import { Track } from '../components/PlayerBar';
import { getAutoMixSettings, getCachedTracks, AutoMixSettings } from './database-service';

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

// Función para obtener claves compatibles en modo "Energy Boost" (aumento de energía)
export const getEnergyKeys = (camelotKey: string): string[] => {
  if (!camelotKey || camelotKey.length < 2) return [];
  const isMinor = camelotKey.endsWith('A');
  const numberStr = camelotKey.slice(0, -1);
  const number = parseInt(numberStr, 10);
  if (isNaN(number)) return [];

  const letter = isMinor ? 'A' : 'B';
  const plusOne = number === 12 ? 1 : number + 1;
  const plusTwo = plusOne === 12 ? 1 : plusOne + 1;
  const plusSeven = (number + 6) % 12 + 1;

  return [
    `${number}${letter}`,
    `${plusOne}${letter}`,
    `${plusTwo}${letter}`,
    `${plusSeven}${letter}`
  ];
};

/**
 * Módulo 2: Genera la cola de AutoMix leyendo parámetros desde SQLite (`getAutoMixSettings()`)
 * o usando el catálogo proporcionado, aplicando FALLBACK DEFENSIVO si los filtros devuelven 0 canciones.
 */
export const generateAutoMixQueue = async (
  currentTrack: Track,
  allTracks?: Track[],
  currentBpm?: number,
  currentKey?: string
): Promise<Track[]> => {
  // 1. Leer parámetros de AutoMix antes de hacer query/filtro en 'tracks'
  const settings: AutoMixSettings = await getAutoMixSettings();
  const bpmTolerance = typeof settings.bpm_tolerance === 'number' ? settings.bpm_tolerance : 3;
  const harmonicMode = settings.harmonic_mode || 'strict';

  // 2. Obtener pool de pistas desde argumento o query de base de datos SQLite ('tracks')
  let pool = allTracks && allTracks.length > 0 ? allTracks : await getCachedTracks();
  if (!pool || pool.length === 0) {
    return [];
  }

  // Excluir la pista actual
  let candidateTracks = pool.filter(track => track.id !== currentTrack.id);
  if (candidateTracks.length === 0) {
    return [];
  }

  // Determinar BPM y Key objetivo
  const targetBpm = currentBpm ?? (currentTrack as any).bpm;
  const targetKey = currentKey ?? (currentTrack as any).camelot_key ?? (currentTrack as any).key;

  // 3. Aplicar filtros según configuración del usuario ('bpm_tolerance' y 'harmonic_mode')
  let filteredTracks = [...candidateTracks];

  if (typeof targetBpm === 'number' && !isNaN(targetBpm)) {
    filteredTracks = filteredTracks.filter(track => {
      const trackBpm = (track as any).bpm as number | undefined;
      if (typeof trackBpm !== 'number' || isNaN(trackBpm)) {
        return false;
      }
      return Math.abs(trackBpm - targetBpm) <= bpmTolerance;
    });
  }

  if (targetKey && harmonicMode !== 'free') {
    const allowedKeys = harmonicMode === 'energy'
      ? getEnergyKeys(targetKey.toUpperCase())
      : getCompatibleKeys(targetKey.toUpperCase());

    filteredTracks = filteredTracks.filter(track => {
      const trackKey = ((track as any).camelot_key || (track as any).key) as string | undefined;
      if (!trackKey) return false;
      return allowedKeys.includes(trackKey.toUpperCase());
    });
  }

  // 4. IMPLEMENTAR FALLBACK DEFENSIVO
  // Si el query con los filtros del usuario ('bpm_tolerance' y 'harmonic_mode') devuelve 0 canciones,
  // el código automáticamente debe ignorar el filtro armónico y buscar la canción con el BPM más cercano.
  if (filteredTracks.length === 0) {
    console.warn('[SmartDJService] Filtros estrictos de AutoMix devolvieron 0 canciones. Ejecutando FALLBACK DEFENSIVO...');
    
    if (typeof targetBpm === 'number' && !isNaN(targetBpm) && candidateTracks.length > 0) {
      // Ignorar filtro armónico (harmonic_mode = 'free') y buscar ordenado por distancia al BPM más cercano
      filteredTracks = [...candidateTracks].sort((a, b) => {
        const bpmA = typeof (a as any).bpm === 'number' ? (a as any).bpm : targetBpm + 999;
        const bpmB = typeof (b as any).bpm === 'number' ? (b as any).bpm : targetBpm + 999;
        return Math.abs(bpmA - targetBpm) - Math.abs(bpmB - targetBpm);
      });
    } else {
      // Si faltan metadatos o targetBpm, tomar todo el pool para evitar cola vacía
      filteredTracks = [...candidateTracks];
    }
  }

  const topCandidates = filteredTracks.slice(0, Math.min(20, filteredTracks.length));
  for (let i = topCandidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [topCandidates[i], topCandidates[j]] = [topCandidates[j], topCandidates[i]];
  }

  return topCandidates.slice(0, 10);
};

/**
 * Versión síncrona de generateSmartQueue con FALLBACK DEFENSIVO integrado
 */
export const generateSmartQueue = (
  currentTrack: Track,
  allTracks: Track[],
  currentBpm?: number,
  currentKey?: string,
  customSettings?: AutoMixSettings
): Track[] => {
  const bpmTolerance = customSettings?.bpm_tolerance ?? 3;
  const harmonicMode = customSettings?.harmonic_mode ?? 'strict';
  
  let candidateTracks = allTracks.filter(track => track.id !== currentTrack.id);
  if (candidateTracks.length === 0) return [];

  const targetBpm = currentBpm ?? (currentTrack as any).bpm;
  const targetKey = currentKey ?? (currentTrack as any).camelot_key ?? (currentTrack as any).key;

  let filteredTracks = [...candidateTracks];

  if (typeof targetBpm === 'number' && !isNaN(targetBpm)) {
    filteredTracks = filteredTracks.filter((track: any) => {
      const trackBpm = track.bpm as number | undefined;
      if (typeof trackBpm !== 'number' || isNaN(trackBpm)) return false;
      return Math.abs(trackBpm - targetBpm) <= bpmTolerance;
    });
  }

  if (targetKey && harmonicMode !== 'free') {
    const allowedKeys = harmonicMode === 'energy'
      ? getEnergyKeys(targetKey.toUpperCase())
      : getCompatibleKeys(targetKey.toUpperCase());

    filteredTracks = filteredTracks.filter((track: any) => {
      const trackKey = (track.camelot_key || track.key) as string | undefined;
      if (!trackKey) return false;
      return allowedKeys.includes(trackKey.toUpperCase());
    });
  }

  // FALLBACK DEFENSIVO
  if (filteredTracks.length === 0) {
    console.warn('[SmartDJService] (Sync) Filtros devolvieron 0 canciones. Ejecutando FALLBACK DEFENSIVO...');
    if (typeof targetBpm === 'number' && !isNaN(targetBpm) && candidateTracks.length > 0) {
      filteredTracks = [...candidateTracks].sort((a: any, b: any) => {
        const bpmA = typeof a.bpm === 'number' ? a.bpm : targetBpm + 999;
        const bpmB = typeof b.bpm === 'number' ? b.bpm : targetBpm + 999;
        return Math.abs(bpmA - targetBpm) - Math.abs(bpmB - targetBpm);
      });
    } else {
      filteredTracks = [...candidateTracks];
    }
  }

  const topCandidates = filteredTracks.slice(0, Math.min(20, filteredTracks.length));
  for (let i = topCandidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [topCandidates[i], topCandidates[j]] = [topCandidates[j], topCandidates[i]];
  }

  return topCandidates.slice(0, 10);
};
