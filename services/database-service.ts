import * as SQLite from 'expo-sqlite';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { Track } from '../components/PlayerBar';

// Singleton de la base de datos y candado de inicialización para evitar colisiones asíncronas
let db: SQLite.SQLiteDatabase | null = null;
let initPromise: Promise<SQLite.SQLiteDatabase | any> | null = null;

// Mock mutable de pistas y base de datos para el entorno Web (Navegador Local Host)
let WEB_MOCK_TRACKS: Track[] = [
  {
    id: 'web-track-1',
    url: 'https://example.com/mock-audio-1.mp3',
    title: 'Midnight Synthwave (Web Preview)',
    artist: 'Milla Sound Labs',
    album: 'Direct Hardware FLAC',
    duration: 214,
    artwork: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=600&q=80',
    bpm: 124,
    key: '8A',
    camelot_key: '8A',
    qualityBadge: 'FLAC 192kHz',
    needs_repair: false,
    needs_sync: false,
  },
  {
    id: 'web-track-2',
    url: 'https://example.com/mock-audio-2.mp3',
    title: 'Neon Horizon (Unreleased Demo)',
    artist: 'ArtistGrid Hi-Res',
    album: 'Unreleased Sessions',
    duration: 188,
    artwork: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=600&q=80',
    bpm: 128,
    key: '9A',
    camelot_key: '9A',
    qualityBadge: 'DSD 64',
    needs_repair: false,
    needs_sync: false,
  },
  {
    id: 'web-track-3',
    url: 'https://example.com/mock-audio-3.mp3',
    title: 'Deep Ocean Odyssey',
    artist: 'Milla DSP Engine',
    album: 'Acoustic Studies',
    duration: 256,
    artwork: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=600&q=80',
    bpm: 118,
    key: '5B',
    camelot_key: '5B',
    qualityBadge: 'FLAC 96kHz',
    needs_repair: false,
    needs_sync: false,
  }
];

export const setWebMockTracks = (tracks: Track[]) => {
  WEB_MOCK_TRACKS = tracks;
};

export const getWebMockTracks = (): Track[] => {
  return WEB_MOCK_TRACKS;
};

export interface AutoMixSettings {
  enabled: boolean;
  bpm_tolerance: number;
  harmonic_mode: 'strict' | 'energy' | 'free';
  crossfade_seconds: number;
  cross_out_enabled: boolean;
  equalizer_preset?: string;
}

let webMockTheme = 'theme-monochrome';
let webMockNotification = true;
let webMockAutoMix: AutoMixSettings = {
  enabled: false,
  bpm_tolerance: 5,
  harmonic_mode: 'free',
  crossfade_seconds: 0,
  cross_out_enabled: false,
  equalizer_preset: 'flat',
};

const getWebMockDatabase = (): any => ({
  execAsync: async () => {},
  runAsync: async () => {},
  getAllAsync: async (query?: string) => {
    if (query && query.includes('tracks')) return WEB_MOCK_TRACKS;
    return [];
  },
  getFirstAsync: async (query?: string) => {
    if (query && query.includes('automix_settings')) return webMockAutoMix;
    if (query && query.includes('app_settings')) return { value: webMockTheme };
    return null;
  },
  prepareAsync: async () => ({
    executeAsync: async () => {},
    finalizeAsync: async () => {},
  }),
});

export const initDatabase = async (): Promise<any> => {
  if (Platform.OS === 'web') {
    return getWebMockDatabase();
  }

  if (db) return db;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const database = await SQLite.openDatabaseAsync('milla.db');
      
      // 🚀 Punto 5.1: Activación del Modo WAL y pragmas de rendimiento para lecturas y escrituras en paralelo
      await database.execAsync(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA cache_size = -10000;
      `);

      // Crear tabla principal de pistas con caché y metadata extendida
      await database.execAsync(`
        CREATE TABLE IF NOT EXISTS tracks (
          id TEXT PRIMARY KEY,
          url TEXT NOT NULL,
          title TEXT NOT NULL,
          artist TEXT NOT NULL,
          album TEXT,
          duration INTEGER NOT NULL,
          artwork TEXT,
          artwork_thumb TEXT,
          bpm REAL,
          key TEXT,
          camelot_key TEXT,
          replayGainTrack REAL,
          replayGainAlbum REAL,
          qualityBadge TEXT,
          needs_repair INTEGER DEFAULT 0,
          needs_sync INTEGER DEFAULT 1,
          lyrics_json TEXT,
          lyrics_lrc TEXT,
          genre TEXT,
          play_count INTEGER DEFAULT 0,
          last_played INTEGER DEFAULT 0
        );
      `);

      await database.execAsync(`
        CREATE TABLE IF NOT EXISTS automix_settings (
          id INTEGER PRIMARY KEY DEFAULT 1,
          enabled INTEGER DEFAULT 0,
          bpm_tolerance INTEGER DEFAULT 5,
          harmonic_mode TEXT DEFAULT 'free',
          crossfade_seconds INTEGER DEFAULT 0,
          cross_out_enabled INTEGER DEFAULT 0,
          equalizer_preset TEXT DEFAULT 'flat'
        );
      `);

      await database.execAsync(`
        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);

      // Migraciones automáticas silenciosas para añadir columnas en bases de datos existentes
      try {
        await database.execAsync('ALTER TABLE tracks ADD COLUMN lyrics_json TEXT;');
      } catch (e) {}
      try {
        await database.execAsync('ALTER TABLE tracks ADD COLUMN lyrics_lrc TEXT;');
      } catch (e) {}
      try {
        await database.execAsync('ALTER TABLE tracks ADD COLUMN lyrics TEXT;');
      } catch (e) {}
      try {
        await database.execAsync('ALTER TABLE tracks ADD COLUMN camelot_key TEXT;');
      } catch (e) {}
      try {
        await database.execAsync('ALTER TABLE tracks ADD COLUMN needs_sync INTEGER DEFAULT 1;');
      } catch (e) {}
      try {
        await database.execAsync('ALTER TABLE tracks ADD COLUMN genre TEXT;');
      } catch (e) {}
      try {
        await database.execAsync('ALTER TABLE tracks ADD COLUMN play_count INTEGER DEFAULT 0;');
      } catch (e) {}
      try {
        await database.execAsync('ALTER TABLE tracks ADD COLUMN last_played INTEGER DEFAULT 0;');
      } catch (e) {}
      try {
        await database.execAsync('ALTER TABLE automix_settings ADD COLUMN enabled INTEGER DEFAULT 1;');
      } catch (e) {}
      try {
        await database.execAsync('ALTER TABLE automix_settings ADD COLUMN cross_out_enabled INTEGER DEFAULT 1;');
      } catch (e) {}
      try {
        await database.execAsync('ALTER TABLE automix_settings ADD COLUMN equalizer_preset TEXT DEFAULT \'flat\';');
      } catch (e) {}
      
      db = database;
      return database;
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
};

// Funciones de utilidad para CRUD rápido
export const getCachedTracks = async (): Promise<Track[]> => {
  if (Platform.OS === 'web') {
    return WEB_MOCK_TRACKS.map(t => ({
      ...t,
      lyrics: t.lyrics_lrc ?? t.lyrics_json ?? (t as any).lyrics
    }));
  }

  const database = await initDatabase();
  const result: any[] = await database.getAllAsync('SELECT * FROM tracks') || [];
  
  return result.map((row: any) => ({
    id: row.id,
    url: row.url,
    title: row.title,
    artist: row.artist,
    album: row.album,
    duration: row.duration,
    artwork: row.artwork,
    artwork_thumb: row.artwork_thumb,
    bpm: row.bpm,
    key: row.key,
    camelot_key: row.camelot_key,
    replayGainTrack: row.replayGainTrack,
    replayGainAlbum: row.replayGainAlbum,
    qualityBadge: row.qualityBadge,
    needs_repair: Boolean(row.needs_repair),
    needs_sync: Boolean(row.needs_sync ?? 1),
    lyrics_json: row.lyrics_json,
    lyrics_lrc: row.lyrics_lrc,
    lyrics: row.lyrics_lrc ?? row.lyrics_json ?? row.lyrics,
    genre: row.genre,
    play_count: row.play_count ?? 0,
    last_played: row.last_played ?? 0,
  }));
};

/**
 * Busca pistas en SQLite mediante un query LIKE instantáneo en título, artista o álbum.
 */
export const searchCachedTracks = async (query: string): Promise<Track[]> => {
  if (!query || !query.trim()) {
    return [];
  }
  if (Platform.OS === 'web') {
    const q = query.toLowerCase().trim();
    return WEB_MOCK_TRACKS.filter(t => 
      t.title.toLowerCase().includes(q) || 
      t.artist.toLowerCase().includes(q) || 
      (t.album && t.album.toLowerCase().includes(q))
    ).map(t => ({
      ...t,
      lyrics: t.lyrics_lrc ?? t.lyrics_json ?? (t as any).lyrics
    }));
  }

  const database = await initDatabase();
  const cleanQuery = `%${query.trim()}%`;
  const result: any[] = await database.getAllAsync(
    'SELECT * FROM tracks WHERE title LIKE ? OR artist LIKE ? OR album LIKE ? ORDER BY title ASC LIMIT 200',
    [cleanQuery, cleanQuery, cleanQuery]
  ) || [];
  
  return result.map((row: any) => ({
    id: row.id,
    url: row.url,
    title: row.title,
    artist: row.artist,
    album: row.album,
    duration: row.duration,
    artwork: row.artwork,
    artwork_thumb: row.artwork_thumb,
    bpm: row.bpm,
    key: row.key,
    camelot_key: row.camelot_key,
    replayGainTrack: row.replayGainTrack,
    replayGainAlbum: row.replayGainAlbum,
    qualityBadge: row.qualityBadge,
    needs_repair: Boolean(row.needs_repair),
    needs_sync: Boolean(row.needs_sync ?? 1),
    lyrics_json: row.lyrics_json,
    lyrics_lrc: row.lyrics_lrc,
    lyrics: row.lyrics_lrc ?? row.lyrics_json ?? row.lyrics,
    genre: row.genre,
    play_count: row.play_count ?? 0,
    last_played: row.last_played ?? 0,
  }));
};

/**
 * Punto 3.2: Actualiza en SQLite los metadatos de análisis (BPM, Camelot Key y Letras JSON)
 * y marca la pista con `needs_sync = 0` (FALSE) de forma permanente.
 */
export const updateTrackAnalysis = async (
  trackId: string,
  data: {
    bpm?: number | null;
    camelot_key?: string | null;
    lyrics_json?: string | null;
    lyrics_lrc?: string | null;
  }
): Promise<boolean> => {
  if (!trackId) return false;
  if (Platform.OS === 'web') return true;

  try {
    const database = await initDatabase();
    
    // Si lyrics_json llega como un array o un objeto en lugar de string, lo serializamos
    let formattedLyricsJson = data.lyrics_json;
    if (formattedLyricsJson && typeof formattedLyricsJson !== 'string') {
      formattedLyricsJson = JSON.stringify(formattedLyricsJson);
    }

    await database.runAsync(
      `UPDATE tracks 
       SET bpm = COALESCE(?, bpm),
           camelot_key = COALESCE(?, camelot_key),
           lyrics_json = COALESCE(?, lyrics_json),
           lyrics_lrc = COALESCE(?, lyrics_lrc),
           needs_sync = 0
       WHERE id = ?`,
      [
        data.bpm !== undefined ? data.bpm : null,
        data.camelot_key !== undefined ? data.camelot_key : null,
        formattedLyricsJson !== undefined ? formattedLyricsJson : null,
        data.lyrics_lrc !== undefined ? data.lyrics_lrc : null,
        trackId,
      ]
    );
    return true;
  } catch (error) {
    console.error(`[DatabaseService] Error en updateTrackAnalysis para track ${trackId}:`, error);
    return false;
  }
};

/**
 * Punto 3.1: Obtiene las pistas que requieren sincronización con el backend Django
 * (aquellas donde needs_sync == 1 o no tienen BPM/Letras guardadas).
 */
export const getTracksNeedingSync = async (limit: number = 50): Promise<Track[]> => {
  if (Platform.OS === 'web') return [];

  try {
    const database = await initDatabase();
    const result: any[] = await database.getAllAsync(
      `SELECT * FROM tracks 
       WHERE needs_sync = 1 OR bpm IS NULL OR camelot_key IS NULL OR (lyrics_lrc IS NULL AND lyrics_json IS NULL)
       ORDER BY title ASC 
       LIMIT ?`,
      [limit]
    ) || [];
    return result.map((row: any) => ({
      id: row.id,
      url: row.url,
      title: row.title,
      artist: row.artist,
      album: row.album,
      duration: row.duration,
      artwork: row.artwork,
      artwork_thumb: row.artwork_thumb,
      bpm: row.bpm,
      key: row.key,
      camelot_key: row.camelot_key,
      replayGainTrack: row.replayGainTrack,
      replayGainAlbum: row.replayGainAlbum,
      qualityBadge: row.qualityBadge,
      needs_repair: Boolean(row.needs_repair),
      needs_sync: Boolean(row.needs_sync ?? 1),
      lyrics_json: row.lyrics_json,
      lyrics_lrc: row.lyrics_lrc,
      lyrics: row.lyrics_lrc ?? row.lyrics_json ?? row.lyrics,
      genre: row.genre,
      play_count: row.play_count ?? 0,
      last_played: row.last_played ?? 0,
    }));
  } catch (error) {
    console.error('[DatabaseService] Error en getTracksNeedingSync:', error);
    return [];
  }
};

/**
 * Inserta o actualiza un lote de pistas en SQLite usando una transacción única
 * para reducir las escrituras a milisegundos en bibliotecas audiófilas masivas.
 */
export const insertTracks = async (tracks: Track[]) => {
  if (tracks.length === 0 || Platform.OS === 'web') return;
  const database = await initDatabase();
  
  await database.execAsync('BEGIN TRANSACTION;');

  const statement = await database.prepareAsync(`
    INSERT OR REPLACE INTO tracks (
      id, url, title, artist, album, duration, artwork, artwork_thumb, 
      bpm, key, camelot_key, replayGainTrack, replayGainAlbum, qualityBadge, needs_repair, needs_sync, lyrics_json, lyrics_lrc, genre, play_count, last_played
    ) VALUES ($id, $url, $title, $artist, $album, $duration, $artwork, $artwork_thumb, $bpm, $key, $camelot_key, $replayGainTrack, $replayGainAlbum, $qualityBadge, $needs_repair, $needs_sync, $lyrics_json, $lyrics_lrc, $genre, $play_count, $last_played)
  `);

  try {
    for (const t of tracks) {
      const needsSyncValue = (t as any).needs_sync !== undefined ? ((t as any).needs_sync ? 1 : 0) : 1;
      await statement.executeAsync({
        $id: t.id ?? null,
        $url: t.url ?? t.id ?? null,
        $title: t.title ?? 'Desconocido',
        $artist: t.artist ?? 'Unknown',
        $album: t.album ?? null,
        $duration: t.duration ?? 0,
        $artwork: t.artwork ?? null,
        $artwork_thumb: t.artwork_thumb ?? null,
        $bpm: t.bpm ?? null,
        $key: t.key ?? null,
        $camelot_key: (t as any).camelot_key ?? null,
        $replayGainTrack: t.replayGainTrack ?? null,
        $replayGainAlbum: t.replayGainAlbum ?? null,
        $qualityBadge: t.qualityBadge ?? null,
        $needs_repair: t.needs_repair ? 1 : 0,
        $needs_sync: needsSyncValue,
        $lyrics_json: (t as any).lyrics_json ?? null,
        $lyrics_lrc: (t as any).lyrics_lrc ?? (t as any).lyrics ?? null,
        $genre: (t as any).genre ?? null,
        $play_count: (t as any).play_count ?? 0,
        $last_played: (t as any).last_played ?? 0,
      } as Record<string, SQLite.SQLiteBindValue>);
    }
    await database.execAsync('COMMIT;');
  } catch (error) {
    console.error('[DatabaseService] Error al insertar pistas por lotes, revirtiendo transacción:', error);
    try {
      await database.execAsync('ROLLBACK;');
    } catch (rollbackErr) {
      console.error('[DatabaseService] Error en ROLLBACK:', rollbackErr);
    }
    throw error;
  } finally {
    await statement.finalizeAsync();
  }
};

export const deleteTracks = async (ids: string[]) => {
  if (ids.length === 0 || Platform.OS === 'web') return;
  const database = await initDatabase();
  await database.execAsync('BEGIN TRANSACTION;');
  try {
    const placeholders = ids.map(() => '?').join(',');
    await database.runAsync(`DELETE FROM tracks WHERE id IN (${placeholders})`, ids);
    await database.execAsync('COMMIT;');
  } catch (error) {
    await database.execAsync('ROLLBACK;');
    throw error;
  }
};

/**
 * Actualiza únicamente la ruta ('uri' -> columna 'url' e 'id') de una pista existente en 'milla.db'
 * cuando un archivo fue movido o reindexado en el sistema, evitando duplicar registros.
 */
export const updateTrackUri = async (oldId: string, newUri: string): Promise<boolean> => {
  if (!oldId || !newUri || oldId === newUri || Platform.OS === 'web') return false;
  try {
    const database = await initDatabase();
    const existingRow: any = await database.getFirstAsync('SELECT id FROM tracks WHERE id = ?;', [newUri]);
    if (existingRow) {
      await database.runAsync('DELETE FROM tracks WHERE id = ?;', [oldId]);
    } else {
      await database.runAsync(
        `UPDATE tracks SET id = ?, url = ? WHERE id = ?;`,
        [newUri, newUri, oldId]
      );
    }
    console.log(`[DatabaseService] Ruta de pista actualizada sin duplicación en milla.db: ${oldId} -> ${newUri}`);
    return true;
  } catch (error) {
    console.error(`[DatabaseService] Error al actualizar ruta de pista ${oldId} a ${newUri}:`, error);
    return false;
  }
};

export const initializeVertexDatabase = initDatabase;

export const getAutoMixSettings = async (): Promise<AutoMixSettings> => {
  if (Platform.OS === 'web') return webMockAutoMix;

  try {
    const database = await initDatabase();
    await database.runAsync(
      `INSERT OR IGNORE INTO automix_settings (id, enabled, bpm_tolerance, harmonic_mode, crossfade_seconds, cross_out_enabled, equalizer_preset) VALUES (1, 0, 5, 'free', 0, 0, 'flat');`
    );
    const row: any = await database.getFirstAsync('SELECT enabled, bpm_tolerance, harmonic_mode, crossfade_seconds, cross_out_enabled, equalizer_preset FROM automix_settings WHERE id = 1;');
    if (row) {
      return {
        enabled: row.enabled !== undefined && row.enabled !== null ? Boolean(row.enabled) : false,
        bpm_tolerance: row.bpm_tolerance !== undefined && row.bpm_tolerance !== null ? Number(row.bpm_tolerance) : 5,
        harmonic_mode: (row.harmonic_mode as any) || 'free',
        crossfade_seconds: row.crossfade_seconds !== undefined && row.crossfade_seconds !== null ? Number(row.crossfade_seconds) : 0,
        cross_out_enabled: row.cross_out_enabled !== undefined && row.cross_out_enabled !== null ? Boolean(row.cross_out_enabled) : false,
        equalizer_preset: row.equalizer_preset || 'flat',
      };
    }
  } catch (error) {
    console.error('[DatabaseService] Error en getAutoMixSettings:', error);
  }
  return {
    enabled: false,
    bpm_tolerance: 5,
    harmonic_mode: 'free',
    crossfade_seconds: 0,
    cross_out_enabled: false,
    equalizer_preset: 'flat',
  };
};

export const saveAutoMixSettings = async (settings: Partial<AutoMixSettings>): Promise<boolean> => {
  if (Platform.OS === 'web') {
    webMockAutoMix = { ...webMockAutoMix, ...settings };
    return true;
  }

  try {
    const database = await initDatabase();
    const current = await getAutoMixSettings();
    const updated = { ...current, ...settings };
    await database.runAsync(
      `INSERT OR REPLACE INTO automix_settings (id, enabled, bpm_tolerance, harmonic_mode, crossfade_seconds, cross_out_enabled, equalizer_preset) VALUES (1, ?, ?, ?, ?, ?, ?);`,
      [
        updated.enabled ? 1 : 0,
        updated.bpm_tolerance,
        updated.harmonic_mode,
        updated.crossfade_seconds,
        updated.cross_out_enabled ? 1 : 0,
        updated.equalizer_preset || 'flat',
      ]
    );
    return true;
  } catch (error) {
    console.error('[DatabaseService] Error en saveAutoMixSettings:', error);
    return false;
  }
};

export const getThemeSetting = async (): Promise<string> => {
  if (Platform.OS === 'web') return webMockTheme;

  try {
    const database = await initDatabase();
    await database.runAsync(
      `INSERT OR IGNORE INTO app_settings (key, value) VALUES ('currentTheme', 'theme-monochrome');`
    );
    const row: any = await database.getFirstAsync("SELECT value FROM app_settings WHERE key = 'currentTheme';");
    return row?.value || 'theme-monochrome';
  } catch (error) {
    console.error('[DatabaseService] Error en getThemeSetting:', error);
    return 'theme-monochrome';
  }
};

export const saveThemeSetting = async (theme: string): Promise<boolean> => {
  if (Platform.OS === 'web') {
    webMockTheme = theme;
    return true;
  }

  try {
    const database = await initDatabase();
    await database.runAsync(
      `INSERT OR REPLACE INTO app_settings (key, value) VALUES ('currentTheme', ?);`,
      [theme]
    );
    return true;
  } catch (error) {
    console.error('[DatabaseService] Error en saveThemeSetting:', error);
    return false;
  }
};

let webMockUsername = 'Yamki';

export const getUsername = async (): Promise<string> => {
  if (Platform.OS === 'web') return webMockUsername;

  try {
    const database = await initDatabase();
    await database.runAsync(
      `INSERT OR IGNORE INTO app_settings (key, value) VALUES ('username', 'Yamki');`
    );
    const row: any = await database.getFirstAsync("SELECT value FROM app_settings WHERE key = 'username';");
    return row?.value || 'Yamki';
  } catch (error) {
    console.error('[DatabaseService] Error en getUsername:', error);
    return 'Yamki';
  }
};

export const saveUsername = async (username: string): Promise<boolean> => {
  if (Platform.OS === 'web') {
    webMockUsername = username;
    return true;
  }

  try {
    const database = await initDatabase();
    await database.runAsync(
      `INSERT OR REPLACE INTO app_settings (key, value) VALUES ('username', ?);`,
      [username]
    );
    return true;
  } catch (error) {
    console.error('[DatabaseService] Error en saveUsername:', error);
    return false;
  }
};

/**
 * Incrementa el contador de reproducciones de una pista y actualiza su timestamp de última vez escuchada.
 */
export const updateTrackPlayCount = async (trackId: string): Promise<void> => {
  if (!trackId || Platform.OS === 'web') return;
  try {
    const database = await initDatabase();
    await database.runAsync(
      `UPDATE tracks SET play_count = COALESCE(play_count, 0) + 1, last_played = ? WHERE id = ?`,
      [Date.now(), trackId]
    );
  } catch (err) {
    console.error('[DatabaseService] Error en updateTrackPlayCount:', err);
  }
};

/**
 * Tarjeta Naranja: Creador de Mixtapes por Género Táctico.
 * Consulta en SQLite pistas del mismo género o estilo al proporcionado.
 */
export const getTracksByGenre = async (genreOrArtist?: string): Promise<Track[]> => {
  const allTracks = await getCachedTracks();
  if (!allTracks || allTracks.length === 0) return [];

  if (!genreOrArtist || !genreOrArtist.trim()) {
    // Fallback: ordenar por género si existe o devolver pistas variadas
    const withGenre = allTracks.filter(t => t.genre);
    if (withGenre.length > 0) return withGenre;
    return [...allTracks].sort(() => Math.random() - 0.5).slice(0, 30);
  }

  const clean = genreOrArtist.toLowerCase().trim();
  const filtered = allTracks.filter(t => 
    (t.genre && t.genre.toLowerCase().includes(clean)) ||
    (t.artist && t.artist.toLowerCase().includes(clean)) ||
    (t.album && t.album.toLowerCase().includes(clean)) ||
    (t.title && t.title.toLowerCase().includes(clean))
  );

  if (filtered.length > 0) {
    return filtered;
  }

  // Si no encuentra por ese término exacto, devuelve una muestra representativa del catálogo
  return [...allTracks].sort(() => Math.random() - 0.5).slice(0, 30);
};

/**
 * Tarjeta Azul: Cápsula del Tiempo (Rescate de Olvidadas).
 * Busca canciones cuyo contador de reproducciones sea igual a 0 o que lleven más tiempo sin escucharse.
 */
export const getForgottenTracks = async (): Promise<Track[]> => {
  if (Platform.OS === 'web') {
    return [...WEB_MOCK_TRACKS].reverse();
  }

  try {
    const database = await initDatabase();
    const result: any[] = await database.getAllAsync(
      `SELECT * FROM tracks 
       ORDER BY COALESCE(play_count, 0) ASC, COALESCE(last_played, 0) ASC, id ASC 
       LIMIT 50`
    ) || [];

    if (result && result.length > 0) {
      return result.map((row: any) => ({
        id: row.id,
        url: row.url,
        title: row.title,
        artist: row.artist,
        album: row.album,
        duration: row.duration,
        artwork: row.artwork,
        artwork_thumb: row.artwork_thumb,
        bpm: row.bpm,
        key: row.key,
        camelot_key: row.camelot_key,
        replayGainTrack: row.replayGainTrack,
        replayGainAlbum: row.replayGainAlbum,
        qualityBadge: row.qualityBadge,
        needs_repair: Boolean(row.needs_repair),
        needs_sync: Boolean(row.needs_sync ?? 1),
        lyrics_json: row.lyrics_json,
        lyrics_lrc: row.lyrics_lrc,
        lyrics: row.lyrics_lrc ?? row.lyrics_json ?? row.lyrics,
        genre: row.genre,
        play_count: row.play_count ?? 0,
        last_played: row.last_played ?? 0,
      }));
    }
  } catch (err) {
    console.error('[DatabaseService] Error en getForgottenTracks:', err);
  }

  const allTracks = await getCachedTracks();
  return [...allTracks].sort((a, b) => ((a.play_count || 0) - (b.play_count || 0))).slice(0, 40);
};

/**
 * Rueda de Emociones: Filtra el catálogo local de SQLite según 5 estados de ánimo.
 */
export const getTracksByEmotion = async (emotion: 'fiesta' | 'triste' | 'alegre' | 'enamorado' | 'relax'): Promise<Track[]> => {
  const allTracks = await getCachedTracks();
  if (!allTracks || allTracks.length === 0) return [];

  let filtered: Track[] = [];

  switch (emotion) {
    case 'fiesta':
      filtered = allTracks.filter(t => 
        (t.bpm && t.bpm >= 118) ||
        (t.genre && /dance|reggaeton|fiesta|house|edm|party|club|perreo|merengue/i.test(t.genre)) ||
        /dance|reggaeton|fiesta|house|edm|party|club|perreo|show|remix/i.test(`${t.title} ${t.artist} ${t.album}`)
      );
      if (filtered.length < 5) {
        filtered = [...allTracks].sort((a, b) => (b.bpm || 120) - (a.bpm || 120)).slice(0, 30);
      }
      break;

    case 'triste':
      filtered = allTracks.filter(t => 
        (t.bpm && t.bpm <= 95) ||
        (t.genre && /balada|sad|acustico|acoustic|lento|triste|melancol/i.test(t.genre)) ||
        /balada|sad|acustico|acoustic|lento|triste|llorar|solo|adiós|dolor/i.test(`${t.title} ${t.artist} ${t.album}`)
      );
      if (filtered.length < 5) {
        filtered = [...allTracks].sort((a, b) => (a.bpm || 90) - (b.bpm || 90)).slice(0, 30);
      }
      break;

    case 'alegre':
      filtered = allTracks.filter(t => 
        (t.camelot_key && t.camelot_key.endsWith('B')) ||
        (t.bpm && t.bpm >= 105 && t.bpm <= 128) ||
        (t.genre && /pop|alegre|happy|upbeat|tropical/i.test(t.genre)) ||
        /alegre|happy|bueno|loco|amor|sol|vida/i.test(`${t.title} ${t.artist} ${t.album}`)
      );
      if (filtered.length < 5) {
        filtered = [...allTracks].sort(() => Math.random() - 0.5).slice(0, 30);
      }
      break;

    case 'enamorado':
      filtered = allTracks.filter(t => 
        (t.bpm && t.bpm >= 75 && t.bpm <= 108) ||
        (t.genre && /romantico|enamorado|love|amor|bolero|ballad|bachata/i.test(t.genre)) ||
        /amor|love|corazon|beso|contigo|enamorado|loco|querer/i.test(`${t.title} ${t.artist} ${t.album}`)
      );
      if (filtered.length < 5) {
        filtered = [...allTracks].sort(() => Math.random() - 0.5).slice(0, 30);
      }
      break;

    case 'relax':
      filtered = allTracks.filter(t => 
        (t.bpm && t.bpm <= 100) ||
        (t.genre && /chill|relax|ambient|lofi|lo-fi|suave|jazz|piano|sleep|lounge/i.test(t.genre)) ||
        /chill|relax|ambient|lofi|suave|noche|paz|calma/i.test(`${t.title} ${t.artist} ${t.album}`)
      );
      if (filtered.length < 5) {
        filtered = [...allTracks].sort((a, b) => (a.bpm || 95) - (b.bpm || 95)).slice(0, 30);
      }
      break;
  }

  return filtered.length > 0 ? filtered : allTracks;
};

// ==========================================
// NOTIFICACIONES LOCALES (OFFLINE SWITCH)
// ==========================================
export const getNotificationSetting = async (): Promise<boolean> => {
  if (Platform.OS === 'web') return webMockNotification;
  try {
    const database = await initDatabase();
    await database.runAsync(
      `INSERT OR IGNORE INTO app_settings (key, value) VALUES ('notification_enabled', 'true');`
    );
    const row: any = await database.getFirstAsync("SELECT value FROM app_settings WHERE key = 'notification_enabled';");
    return row?.value !== 'false';
  } catch (error) {
    console.error('[DatabaseService] Error en getNotificationSetting:', error);
    return true;
  }
};

export const saveNotificationSetting = async (enabled: boolean): Promise<boolean> => {
  if (Platform.OS === 'web') {
    webMockNotification = enabled;
    return true;
  }
  try {
    const database = await initDatabase();
    await database.runAsync(
      `INSERT OR REPLACE INTO app_settings (key, value) VALUES ('notification_enabled', ?);`,
      [enabled ? 'true' : 'false']
    );
    return true;
  } catch (error) {
    console.error('[DatabaseService] Error en saveNotificationSetting:', error);
    return false;
  }
};

// ==========================================
// RESPALDO Y RESTAURACIÓN LOCAL (SQLite Backup)
// ==========================================
export const createLocalBackup = async (): Promise<{ success: boolean; filePathOrMessage: string }> => {
  try {
    const tracks = await getCachedTracks();
    const automix = await getAutoMixSettings();
    let appSettings: any[] = [];
    if (Platform.OS !== 'web') {
      const database = await initDatabase();
      appSettings = (await database.getAllAsync('SELECT * FROM app_settings')) || [];
    } else {
      appSettings = [
        { key: 'currentTheme', value: webMockTheme },
        { key: 'username', value: webMockUsername },
        { key: 'notification_enabled', value: webMockNotification ? 'true' : 'false' }
      ];
    }

    const backupPayload = {
      version: '1.0.0',
      app: 'Milla Hi-Res Audio',
      created_at: Date.now(),
      date_iso: new Date().toISOString(),
      data: {
        tracks,
        automix_settings: automix,
        app_settings: appSettings,
      }
    };

    const jsonString = JSON.stringify(backupPayload, null, 2);
    const fileName = `milla_backup_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;

    if (Platform.OS === 'web') {
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return { success: true, filePathOrMessage: `Descargado en navegador: ${fileName}` };
    } else {
      const backupDir = FileSystem.documentDirectory + 'Milla/Backups/';
      await FileSystem.makeDirectoryAsync(backupDir, { intermediates: true });
      const fileUri = backupDir + fileName;
      await FileSystem.writeAsStringAsync(fileUri, jsonString, { encoding: FileSystem.EncodingType.UTF8 });
      return { success: true, filePathOrMessage: fileUri };
    }
  } catch (error: any) {
    console.error('[DatabaseService] Error al crear respaldo local:', error);
    return { success: false, filePathOrMessage: error?.message || 'Error desconocido' };
  }
};

export const listLocalBackups = async (): Promise<{ name: string; uri: string; size?: number }[]> => {
  if (Platform.OS === 'web') return [];
  try {
    const backupDir = FileSystem.documentDirectory + 'Milla/Backups/';
    const dirInfo = await FileSystem.getInfoAsync(backupDir);
    if (!dirInfo.exists) return [];
    const files = await FileSystem.readDirectoryAsync(backupDir);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    const result: { name: string; uri: string; size?: number }[] = [];
    for (const f of jsonFiles) {
      const uri = backupDir + f;
      const info = await FileSystem.getInfoAsync(uri);
      result.push({ name: f, uri, size: info.exists ? info.size : undefined });
    }
    return result.sort((a, b) => b.name.localeCompare(a.name));
  } catch (err) {
    console.error('[DatabaseService] Error en listLocalBackups:', err);
    return [];
  }
};

export const restoreLocalBackup = async (fileUriOrContent?: string): Promise<boolean> => {
  try {
    let jsonString = '';
    if (!fileUriOrContent) {
      if (Platform.OS === 'web') return false;
      const backups = await listLocalBackups();
      if (backups.length === 0) return false;
      const latest = backups[0];
      jsonString = await FileSystem.readAsStringAsync(latest.uri, { encoding: FileSystem.EncodingType.UTF8 });
    } else if (fileUriOrContent.startsWith('file://') || fileUriOrContent.startsWith('/') || fileUriOrContent.includes(':/')) {
      jsonString = await FileSystem.readAsStringAsync(fileUriOrContent, { encoding: FileSystem.EncodingType.UTF8 });
    } else {
      jsonString = fileUriOrContent;
    }

    const parsed = JSON.parse(jsonString);
    if (!parsed || !parsed.data) return false;

    if (Platform.OS === 'web') {
      if (Array.isArray(parsed.data.tracks)) {
        WEB_MOCK_TRACKS = parsed.data.tracks;
      }
      if (parsed.data.automix_settings) {
        webMockAutoMix = { ...webMockAutoMix, ...parsed.data.automix_settings };
      }
      if (Array.isArray(parsed.data.app_settings)) {
        for (const s of parsed.data.app_settings) {
          if (s.key === 'currentTheme') webMockTheme = s.value;
          if (s.key === 'notification_enabled') webMockNotification = s.value !== 'false';
        }
      }
      return true;
    }

    const database = await initDatabase();
    await database.execAsync('BEGIN TRANSACTION;');

    if (Array.isArray(parsed.data.tracks)) {
      for (const t of parsed.data.tracks) {
        if (!t.id || !t.url) continue;
        await database.runAsync(
          `INSERT OR REPLACE INTO tracks (id, url, title, artist, album, duration, artwork, artwork_thumb, bpm, key, camelot_key, replayGainTrack, replayGainAlbum, qualityBadge, needs_repair, needs_sync, lyrics_json, lyrics_lrc, genre, play_count, last_played)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          [
            t.id,
            t.url,
            t.title || 'Desconocido',
            t.artist || 'Artista Desconocido',
            t.album || '',
            t.duration || 0,
            t.artwork || '',
            t.artwork_thumb || '',
            t.bpm || null,
            t.key || null,
            t.camelot_key || null,
            t.replayGainTrack || null,
            t.replayGainAlbum || null,
            t.qualityBadge || '',
            t.needs_repair ? 1 : 0,
            t.needs_sync ? 1 : 0,
            t.lyrics_json || null,
            t.lyrics_lrc || null,
            t.genre || null,
            t.play_count || 0,
            t.last_played || 0
          ]
        );
      }
    }

    if (parsed.data.automix_settings) {
      const am = parsed.data.automix_settings;
      await database.runAsync(
        `INSERT OR REPLACE INTO automix_settings (id, enabled, bpm_tolerance, harmonic_mode, crossfade_seconds, cross_out_enabled, equalizer_preset) VALUES (1, ?, ?, ?, ?, ?, ?);`,
        [
          am.enabled ? 1 : 0,
          am.bpm_tolerance || 5,
          am.harmonic_mode || 'free',
          am.crossfade_seconds || 0,
          am.cross_out_enabled ? 1 : 0,
          am.equalizer_preset || 'flat'
        ]
      );
    }

    if (Array.isArray(parsed.data.app_settings)) {
      for (const s of parsed.data.app_settings) {
        if (s.key && s.value) {
          await database.runAsync(`INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?);`, [s.key, String(s.value)]);
        }
      }
    }

    await database.execAsync('COMMIT;');
    return true;
  } catch (error) {
    console.error('[DatabaseService] Error en restoreLocalBackup:', error);
    try {
      if (Platform.OS !== 'web') {
        const database = await initDatabase();
        await database.execAsync('ROLLBACK;');
      }
    } catch (e) {}
    return false;
  }
};
