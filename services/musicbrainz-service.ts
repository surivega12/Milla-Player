// services/musicbrainz-service.ts
export interface MusicBrainzResult {
  id: string;
  title: string;
  artist: string;
  album: string;
  score: number;
}

export const searchRecording = async (query: string): Promise<MusicBrainzResult | null> => {
  try {
    // MusicBrainz API requires a unique User-Agent
    const headers = {
      'User-Agent': 'MillaMusicPlayer/1.0.0 ( contact@milla.app )',
      'Accept': 'application/json',
    };

    // Encode the query, e.g., "track_01_unknown" or "artist - title"
    const encodedQuery = encodeURIComponent(query);
    const url = `https://musicbrainz.org/ws/2/recording?query=${encodedQuery}&fmt=json&limit=5`;

    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      console.warn(`[MusicBrainz] Error en la respuesta: ${response.status}`);
      return null;
    }

    const data = await response.json();
    
    if (data.recordings && data.recordings.length > 0) {
      // Tomamos el mejor resultado
      const bestMatch = data.recordings[0];
      
      const title = bestMatch.title;
      const artist = bestMatch['artist-credit']?.[0]?.name || 'Desconocido';
      const album = bestMatch.releases?.[0]?.title || 'Sencillo/Desconocido';
      
      return {
        id: bestMatch.id,
        title,
        artist,
        album,
        score: bestMatch.score,
      };
    }
    
    return null;
  } catch (error) {
    console.warn('[MusicBrainz] Error al conectar con la API:', error);
    return null;
  }
};
