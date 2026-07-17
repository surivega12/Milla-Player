export interface LyricLine {
  time: number; // Tiempo en segundos
  text: string; // Contenido de la línea de texto
}

/**
 * Convierte el contenido de un archivo .lrc a un array ordenado de LyricLines.
 */
export function parseLrc(lrcText: string): LyricLine[] {
  if (!lrcText) return [];
  
  const lines = lrcText.split(/\r?\n/);
  const result: LyricLine[] = [];
  
  // Expresión regular para capturar formatos como [00:12.50] o [02:04.125]
  const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/g;

  for (const line of lines) {
    // Extraer el texto eliminando todas las marcas de tiempo de la línea
    const text = line.replace(/\[\d{2}:\d{2}\.\d{2,3}\]/g, '').trim();
    if (!text) continue;

    timeRegex.lastIndex = 0;
    let match;
    while ((match = timeRegex.exec(line)) !== null) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const millisecondsStr = match[3];
      const milliseconds = parseInt(millisecondsStr, 10);
      
      // Si los milisegundos tienen 2 cifras (ej: .50), equivalen a 500ms
      const msFactor = millisecondsStr.length === 2 ? 10 : 1;
      const totalTime = minutes * 60 + seconds + (milliseconds * msFactor) / 1000;
      
      result.push({ time: totalTime, text });
    }
  }

  return result.sort((a, b) => a.time - b.time);
}

/**
 * Proporciona letras sincronizadas locales (.lrc) o un estado informativo 100% offline.
 */
export function getDemoLyrics(trackId: string, track?: any): string {
  if (track && (track.lyrics_lrc || track.lyrics)) {
    return track.lyrics_lrc || track.lyrics;
  }

  return `
[00:00.00] Letras Sincronizadas • Modo Offline
[00:04.00] No se detectaron etiquetas .LRC embebidas en este archivo FLAC/MP3 local.
[00:10.00] Cuando la pista contenga metadatos de letras en SQLite, aparecerán aquí.
[00:18.00] Audio Engine Active • Lossless Direct Playback
  `;
}
