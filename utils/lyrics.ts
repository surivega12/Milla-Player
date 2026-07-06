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
 * Proporciona letras sincronizadas demo (.lrc) basadas en el track ID.
 */
export function getDemoLyrics(trackId: string): string {
  const lyrics: Record<string, string> = {
    'track-1': `
[00:00.00] Milla Engine - Monochrome Symphony
[00:04.00] (Instrumental Intro - High Fidelity Lossless)
[00:10.00] Bienvenidos al sonido sin compresión nativa
[00:16.00] Escucha el espacio entre las notas del chelo
[00:23.00] Las frecuencias altas respiran sin compresión digital
[00:30.00] El convertidor DAC trabaja a su máxima resolución
[00:38.00] FLAC de 24 bits flotando en un fondo cristalino
[00:46.00] Siente la pureza de cada oscilación analógica
[00:54.00] La simetría matemática del sonido audiófilo
[01:02.00] Monochrome Symphony...
[01:10.00] (Solo de Violín y Procesamiento DAC de 192kHz)
[01:25.00] Las ondas acústicas dibujan una arquitectura perfecta
[01:32.00] El ruido de fondo desaparece en el vacío absoluto
[01:40.00] Donde la tecnología y el arte se fusionan en Milla
[01:48.00] Sonido puro, fidelidad absoluta.
    `,
    'track-2': `
[00:00.00] Nordic Audio Collective - Deep Forest
[00:05.00] (Eco de viento y sintetizadores analógicos)
[00:12.00] Caminando bajo el follaje verde esmeralda
[00:19.00] El sonido de las hojas cae en resolución pura
[00:27.00] Un búfer profundo nos protege de las pausas del mundo
[00:35.00] Siento el latido orgánico del motor acústico
[00:43.00] Respira la calma del norte de Europa
[00:51.00] El viento silba en frecuencias sin pérdida
[01:00.00] (Transición de percusión y campanas tubulares)
[01:15.00] La naturaleza no conoce la compresión MP3
[01:23.00] Cada onda viaja libre a través del bosque helado
[01:31.00] Milla reproduce el murmullo de la tierra
[01:39.00] Sin pérdida, sin límites.
    `,
    'track-3': `
[00:00.00] Synthwave Dreams - Purple Horizon
[00:04.00] (Bajo arpegiador de sintetizador analógico de los 80)
[00:10.00] Conduciendo hacia el sol poniente de neón violeta
[00:16.00] Las variables CSS pintan la carretera en tiempo real
[00:22.00] El motor de audio bombea 192kHz en las venas
[00:29.00] Siento la velocidad digital en mi pantalla táctil
[00:36.00] Purple Horizon... cruza la línea del búfer
[00:43.00] El vinilo gira en el interior de nuestra carátula
[00:50.00] (Solo de sintetizador FM clásico)
[01:05.00] Los bits corren veloces bajo la capa esmerilada
[01:12.00] Reanimated controla la fluidez del horizonte
[01:20.00] Siente la aceleración del hardware de audio nativo
[01:27.00] Milla viaja al futuro retro del sonido.
    `,
  };

  return lyrics[trackId] || `
[00:00.00] Reproduciendo audio local en alta fidelidad
[00:05.00] Milla decodifica este archivo de forma nativa
[00:12.00] Disfruta del sonido puro sin pérdidas
[00:20.00] Toca la barra de volumen o minimiza para explorar la biblioteca
[00:30.00] Audio Engine Active • FLAC Lossless Direct
  `;
}
