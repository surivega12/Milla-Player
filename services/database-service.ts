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
  volume_normalization?: boolean;
  equalizer_preset?: string;
}

export interface PlaylistSummary {
  id: string;
  name: string;
  artwork?: string;
  track_count: number;
  created_at: number;
  updated_at: number;
  is_system?: boolean;
}

const FAVORITES_PLAYLIST_ID = 'milla:favorites';
let webMockPlaylists: PlaylistSummary[] = [];
const webMockPlaylistTracks = new Map<string, string[]>();

let webMockTheme = 'theme-monochrome';
let webMockNotification = true;
let webMockAutoMix: AutoMixSettings = {
  enabled: false,
  bpm_tolerance: 5,
  harmonic_mode: 'free',
  crossfade_seconds: 6,
  cross_out_enabled: true,
  volume_normalization: false,
  equalizer_preset: 'flat',
};

const mapTrackRow = (row: any): Track => ({
  id: row.id,
  url: row.url,
  source_uri: row.source_uri,
  file_extension: row.file_extension,
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
  lyrics_ttml: row.lyrics_ttml,
  lyrics_plain: row.lyrics_plain,
  lyrics_source: row.lyrics_source,
  lyrics: row.lyrics_lrc ?? row.lyrics_plain ?? row.lyrics_json ?? row.lyrics,
  genre: row.genre,
  play_count: row.play_count ?? 0,
  last_played: row.last_played ?? 0,
  vocal_silence_start_ms: row.vocal_silence_start_ms,
  vocal_silence_end_ms: row.vocal_silence_end_ms,
  intro_duration_ms: row.intro_duration_ms,
  outro_duration_ms: row.outro_duration_ms,
  outro_start_ms: row.outro_start_ms,
  intro_energy: row.intro_energy,
  outro_energy: row.outro_energy,
  beat_interval_ms: row.beat_interval_ms,
  analysis_version: row.analysis_version,
  analysis_status: row.analysis_status,
});

const TRACK_LIST_COLUMNS = `
  id, url, source_uri, file_extension, title, artist, album, duration, artwork, artwork_thumb,
  bpm, key, camelot_key, replayGainTrack, replayGainAlbum, qualityBadge,
  needs_repair, needs_sync, lyrics_source, genre, play_count, last_played,
  vocal_silence_start_ms, vocal_silence_end_ms, intro_duration_ms,
  outro_duration_ms, outro_start_ms, intro_energy, outro_energy,
  beat_interval_ms, analysis_version, analysis_status
`;

// Sync needs lyric state but not every historical column returned by SELECT *.
const TRACK_SYNC_COLUMNS = `${TRACK_LIST_COLUMNS}, lyrics_json, lyrics_lrc, lyrics_ttml, lyrics_plain`;

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
        PRAGMA foreign_keys = ON;
      `);

      // Crear tabla principal de pistas con caché y metadata extendida
      await database.execAsync(`
        CREATE TABLE IF NOT EXISTS tracks (
          id TEXT PRIMARY KEY,
          url TEXT NOT NULL,
          source_uri TEXT,
          file_extension TEXT,
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
          lyrics_ttml TEXT,
          lyrics_plain TEXT,
          lyrics_source TEXT,
          genre TEXT,
          play_count INTEGER DEFAULT 0,
          last_played INTEGER DEFAULT 0,
          vocal_silence_start_ms REAL,
          vocal_silence_end_ms REAL,
          intro_duration_ms REAL,
          outro_duration_ms REAL,
          outro_start_ms REAL,
          intro_energy REAL,
          outro_energy REAL,
          beat_interval_ms REAL,
          analysis_version TEXT,
          analysis_status TEXT DEFAULT 'pending'
        );
      `);

      await database.execAsync(`
        CREATE TABLE IF NOT EXISTS automix_settings (
          id INTEGER PRIMARY KEY DEFAULT 1,
          enabled INTEGER DEFAULT 0,
          bpm_tolerance INTEGER DEFAULT 5,
          harmonic_mode TEXT DEFAULT 'free',
          crossfade_seconds INTEGER DEFAULT 6,
          cross_out_enabled INTEGER DEFAULT 1,
          volume_normalization INTEGER DEFAULT 0,
          equalizer_preset TEXT DEFAULT 'flat'
        );
      `);

      await database.execAsync(`
        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);

      await database.execAsync(`
        CREATE TABLE IF NOT EXISTS playlists (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL COLLATE NOCASE UNIQUE,
          artwork TEXT,
          is_system INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS playlist_tracks (
          playlist_id TEXT NOT NULL,
          track_id TEXT NOT NULL,
          position INTEGER NOT NULL DEFAULT 0,
          added_at INTEGER NOT NULL,
          PRIMARY KEY (playlist_id, track_id),
          FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
          FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
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
      for (const migration of [
        'ALTER TABLE tracks ADD COLUMN lyrics_ttml TEXT;',
        'ALTER TABLE tracks ADD COLUMN lyrics_plain TEXT;',
        'ALTER TABLE tracks ADD COLUMN lyrics_source TEXT;',
        'ALTER TABLE tracks ADD COLUMN source_uri TEXT;',
        'ALTER TABLE tracks ADD COLUMN file_extension TEXT;',
        'ALTER TABLE tracks ADD COLUMN vocal_silence_start_ms REAL;',
        'ALTER TABLE tracks ADD COLUMN vocal_silence_end_ms REAL;',
        'ALTER TABLE tracks ADD COLUMN intro_duration_ms REAL;',
        'ALTER TABLE tracks ADD COLUMN outro_duration_ms REAL;',
        'ALTER TABLE tracks ADD COLUMN outro_start_ms REAL;',
        'ALTER TABLE tracks ADD COLUMN intro_energy REAL;',
        'ALTER TABLE tracks ADD COLUMN outro_energy REAL;',
        'ALTER TABLE tracks ADD COLUMN beat_interval_ms REAL;',
        'ALTER TABLE tracks ADD COLUMN analysis_version TEXT;',
        "ALTER TABLE tracks ADD COLUMN analysis_status TEXT DEFAULT 'pending';",
      ]) {
        try {
          await database.execAsync(migration);
        } catch (e) {}
      }
      try {
        await database.execAsync('ALTER TABLE automix_settings ADD COLUMN enabled INTEGER DEFAULT 1;');
      } catch (e) {}
      try {
        await database.execAsync('ALTER TABLE automix_settings ADD COLUMN cross_out_enabled INTEGER DEFAULT 1;');
      } catch (e) {}
      try {
        await database.execAsync('ALTER TABLE automix_settings ADD COLUMN equalizer_preset TEXT DEFAULT \'flat\';');
      } catch (e) {}
      try {
        await database.execAsync('ALTER TABLE automix_settings ADD COLUMN volume_normalization INTEGER DEFAULT 0;');
      } catch (e) {}

      await database.execAsync(`
        CREATE INDEX IF NOT EXISTS idx_tracks_title_nocase ON tracks(title COLLATE NOCASE);
        CREATE INDEX IF NOT EXISTS idx_tracks_artist_nocase ON tracks(artist COLLATE NOCASE);
        CREATE INDEX IF NOT EXISTS idx_tracks_album_nocase ON tracks(album COLLATE NOCASE);
        CREATE INDEX IF NOT EXISTS idx_tracks_sync_state ON tracks(needs_sync, analysis_status);
        CREATE INDEX IF NOT EXISTS idx_tracks_source_uri ON tracks(source_uri);
        CREATE INDEX IF NOT EXISTS idx_playlist_tracks_position ON playlist_tracks(playlist_id, position);
      `);

      const now = Date.now();
      await database.runAsync(
        `INSERT OR IGNORE INTO playlists (id, name, is_system, created_at, updated_at)
         VALUES (?, 'Me encanta', 1, ?, ?);`,
        [FAVORITES_PLAYLIST_ID, now, now]
      );
      
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
  const result: any[] = await database.getAllAsync(
    `SELECT ${TRACK_LIST_COLUMNS} FROM tracks ORDER BY title COLLATE NOCASE ASC`
  ) || [];
  return result.map(mapTrackRow);
};

export const getCachedTrackById = async (trackId: string): Promise<Track | null> => {
  if (!trackId) return null;
  if (Platform.OS === 'web') {
    return WEB_MOCK_TRACKS.find((track) => track.id === trackId) ?? null;
  }
  const database = await initDatabase();
  const row = await database.getFirstAsync('SELECT * FROM tracks WHERE id = ? LIMIT 1', [trackId]);
  return row ? mapTrackRow(row) : null;
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
    `SELECT ${TRACK_LIST_COLUMNS}
     FROM tracks
     WHERE title LIKE ? OR artist LIKE ? OR album LIKE ?
     ORDER BY title COLLATE NOCASE ASC
     LIMIT 200`,
    [cleanQuery, cleanQuery, cleanQuery]
  ) || [];
  
  return result.map(mapTrackRow);
};

/**
 * Punto 3.2: Actualiza en SQLite los metadatos de análisis (BPM, Camelot Key y Letras JSON)
 * y marca la pista con `needs_sync = 0` (FALSE) de forma permanente.
 */
export const updateTrackAnalysis = async (
  trackId: string,
  data: {
    duration?: number | null;
    bpm?: number | null;
    camelot_key?: string | null;
    lyrics_json?: string | null;
    lyrics_lrc?: string | null;
    lyrics_ttml?: string | null;
    lyrics_plain?: string | null;
    lyrics_source?: string | null;
    vocal_silence_start_ms?: number | null;
    vocal_silence_end_ms?: number | null;
    intro_duration_ms?: number | null;
    outro_duration_ms?: number | null;
    outro_start_ms?: number | null;
    intro_energy?: number | null;
    outro_energy?: number | null;
    beat_interval_ms?: number | null;
    analysis_version?: string | null;
    analysis_status?: string | null;
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
       SET duration = COALESCE(?, duration),
           bpm = COALESCE(?, bpm),
           camelot_key = COALESCE(?, camelot_key),
           lyrics_json = COALESCE(?, lyrics_json),
           lyrics_lrc = COALESCE(?, lyrics_lrc),
           lyrics_ttml = COALESCE(?, lyrics_ttml),
           lyrics_plain = COALESCE(?, lyrics_plain),
           lyrics_source = COALESCE(?, lyrics_source),
           vocal_silence_start_ms = COALESCE(?, vocal_silence_start_ms),
           vocal_silence_end_ms = COALESCE(?, vocal_silence_end_ms),
           intro_duration_ms = COALESCE(?, intro_duration_ms),
           outro_duration_ms = COALESCE(?, outro_duration_ms),
           outro_start_ms = COALESCE(?, outro_start_ms),
           intro_energy = COALESCE(?, intro_energy),
           outro_energy = COALESCE(?, outro_energy),
           beat_interval_ms = COALESCE(?, beat_interval_ms),
           analysis_version = COALESCE(?, analysis_version),
           analysis_status = COALESCE(?, analysis_status),
           needs_sync = 0
       WHERE id = ?`,
      [
        data.duration !== undefined ? data.duration : null,
        data.bpm !== undefined ? data.bpm : null,
        data.camelot_key !== undefined ? data.camelot_key : null,
        formattedLyricsJson !== undefined ? formattedLyricsJson : null,
        data.lyrics_lrc !== undefined ? data.lyrics_lrc : null,
        data.lyrics_ttml !== undefined ? data.lyrics_ttml : null,
        data.lyrics_plain !== undefined ? data.lyrics_plain : null,
        data.lyrics_source !== undefined ? data.lyrics_source : null,
        data.vocal_silence_start_ms !== undefined ? data.vocal_silence_start_ms : null,
        data.vocal_silence_end_ms !== undefined ? data.vocal_silence_end_ms : null,
        data.intro_duration_ms !== undefined ? data.intro_duration_ms : null,
        data.outro_duration_ms !== undefined ? data.outro_duration_ms : null,
        data.outro_start_ms !== undefined ? data.outro_start_ms : null,
        data.intro_energy !== undefined ? data.intro_energy : null,
        data.outro_energy !== undefined ? data.outro_energy : null,
        data.beat_interval_ms !== undefined ? data.beat_interval_ms : null,
        data.analysis_version !== undefined ? data.analysis_version : null,
        data.analysis_status !== undefined ? data.analysis_status : null,
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
      `SELECT ${TRACK_SYNC_COLUMNS} FROM tracks
       WHERE needs_sync = 1
          OR ((lyrics_lrc IS NULL AND lyrics_json IS NULL AND lyrics_ttml IS NULL AND lyrics_plain IS NULL)
              AND COALESCE(lyrics_source, '') <> 'not_found')
          OR COALESCE(analysis_status, 'pending') = 'pending'
       ORDER BY title ASC 
       LIMIT ?`,
      [limit]
    ) || [];
    return result.map(mapTrackRow);
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
    INSERT INTO tracks (
      id, url, source_uri, file_extension, title, artist, album, duration, artwork, artwork_thumb,
      bpm, key, camelot_key, replayGainTrack, replayGainAlbum, qualityBadge, needs_repair, needs_sync,
      lyrics_json, lyrics_lrc, lyrics_ttml, lyrics_plain, lyrics_source, genre, play_count, last_played,
      vocal_silence_start_ms, vocal_silence_end_ms, intro_duration_ms, outro_duration_ms, outro_start_ms,
      intro_energy, outro_energy, beat_interval_ms, analysis_version, analysis_status
    ) VALUES (
      $id, $url, $source_uri, $file_extension, $title, $artist, $album, $duration, $artwork, $artwork_thumb,
      $bpm, $key, $camelot_key, $replayGainTrack, $replayGainAlbum, $qualityBadge, $needs_repair, $needs_sync,
      $lyrics_json, $lyrics_lrc, $lyrics_ttml, $lyrics_plain, $lyrics_source, $genre, $play_count, $last_played,
      $vocal_silence_start_ms, $vocal_silence_end_ms, $intro_duration_ms, $outro_duration_ms, $outro_start_ms,
      $intro_energy, $outro_energy, $beat_interval_ms, $analysis_version, $analysis_status
    )
    ON CONFLICT(id) DO UPDATE SET
      url = excluded.url,
      source_uri = COALESCE(excluded.source_uri, tracks.source_uri),
      file_extension = COALESCE(excluded.file_extension, tracks.file_extension),
      title = excluded.title,
      artist = excluded.artist,
      album = excluded.album,
      duration = excluded.duration,
      artwork = COALESCE(excluded.artwork, tracks.artwork),
      artwork_thumb = COALESCE(excluded.artwork_thumb, tracks.artwork_thumb),
      bpm = COALESCE(excluded.bpm, tracks.bpm),
      key = COALESCE(excluded.key, tracks.key),
      camelot_key = COALESCE(excluded.camelot_key, tracks.camelot_key),
      replayGainTrack = COALESCE(excluded.replayGainTrack, tracks.replayGainTrack),
      replayGainAlbum = COALESCE(excluded.replayGainAlbum, tracks.replayGainAlbum),
      qualityBadge = COALESCE(excluded.qualityBadge, tracks.qualityBadge),
      needs_repair = excluded.needs_repair,
      needs_sync = CASE WHEN tracks.needs_sync = 0 THEN 0 ELSE excluded.needs_sync END,
      lyrics_json = COALESCE(excluded.lyrics_json, tracks.lyrics_json),
      lyrics_lrc = COALESCE(excluded.lyrics_lrc, tracks.lyrics_lrc),
      lyrics_ttml = COALESCE(excluded.lyrics_ttml, tracks.lyrics_ttml),
      lyrics_plain = COALESCE(excluded.lyrics_plain, tracks.lyrics_plain),
      lyrics_source = COALESCE(excluded.lyrics_source, tracks.lyrics_source),
      genre = COALESCE(excluded.genre, tracks.genre),
      play_count = MAX(tracks.play_count, excluded.play_count),
      last_played = MAX(tracks.last_played, excluded.last_played),
      vocal_silence_start_ms = COALESCE(excluded.vocal_silence_start_ms, tracks.vocal_silence_start_ms),
      vocal_silence_end_ms = COALESCE(excluded.vocal_silence_end_ms, tracks.vocal_silence_end_ms),
      intro_duration_ms = COALESCE(excluded.intro_duration_ms, tracks.intro_duration_ms),
      outro_duration_ms = COALESCE(excluded.outro_duration_ms, tracks.outro_duration_ms),
      outro_start_ms = COALESCE(excluded.outro_start_ms, tracks.outro_start_ms),
      intro_energy = COALESCE(excluded.intro_energy, tracks.intro_energy),
      outro_energy = COALESCE(excluded.outro_energy, tracks.outro_energy),
      beat_interval_ms = COALESCE(excluded.beat_interval_ms, tracks.beat_interval_ms),
      analysis_version = COALESCE(excluded.analysis_version, tracks.analysis_version),
      analysis_status = COALESCE(excluded.analysis_status, tracks.analysis_status)
  `);

  try {
    for (const t of tracks) {
      const needsSyncValue = (t as any).needs_sync !== undefined ? ((t as any).needs_sync ? 1 : 0) : 1;
      await statement.executeAsync({
        $id: t.id ?? null,
        $url: t.url ?? t.id ?? null,
        $source_uri: (t as any).source_uri ?? null,
        $file_extension: (t as any).file_extension ?? null,
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
        $lyrics_ttml: (t as any).lyrics_ttml ?? null,
        $lyrics_plain: (t as any).lyrics_plain ?? null,
        $lyrics_source: (t as any).lyrics_source ?? null,
        $genre: (t as any).genre ?? null,
        $play_count: (t as any).play_count ?? 0,
        $last_played: (t as any).last_played ?? 0,
        $vocal_silence_start_ms: (t as any).vocal_silence_start_ms ?? null,
        $vocal_silence_end_ms: (t as any).vocal_silence_end_ms ?? null,
        $intro_duration_ms: (t as any).intro_duration_ms ?? null,
        $outro_duration_ms: (t as any).outro_duration_ms ?? null,
        $outro_start_ms: (t as any).outro_start_ms ?? null,
        $intro_energy: (t as any).intro_energy ?? null,
        $outro_energy: (t as any).outro_energy ?? null,
        $beat_interval_ms: (t as any).beat_interval_ms ?? null,
        $analysis_version: (t as any).analysis_version ?? null,
        $analysis_status: (t as any).analysis_status ?? 'pending',
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
    return true;
  } catch (error) {
    console.error(`[DatabaseService] Error al actualizar ruta de pista ${oldId} a ${newUri}:`, error);
    return false;
  }
};

/**
 * Stores a file:// copy used by native playback while retaining the original
 * MediaStore/SAF URI. Cache files may disappear, so source_uri is never lost.
 */
export const updateTrackPlaybackUri = async (
  trackId: string,
  playbackUri: string,
  sourceUri?: string
): Promise<boolean> => {
  if (!trackId || !playbackUri || Platform.OS === 'web') return false;
  try {
    const database = await initDatabase();
    await database.runAsync(
      `UPDATE tracks
       SET url = ?, source_uri = COALESCE(source_uri, ?)
       WHERE id = ?;`,
      [playbackUri, sourceUri || null, trackId]
    );
    return true;
  } catch (error) {
    console.warn(`[DatabaseService] No se pudo guardar la ruta reproducible de ${trackId}:`, error);
    return false;
  }
};

export const initializeVertexDatabase = initDatabase;

export const getAutoMixSettings = async (): Promise<AutoMixSettings> => {
  if (Platform.OS === 'web') return webMockAutoMix;

  try {
    const database = await initDatabase();
    await database.runAsync(
      `INSERT OR IGNORE INTO automix_settings (id, enabled, bpm_tolerance, harmonic_mode, crossfade_seconds, cross_out_enabled, volume_normalization, equalizer_preset) VALUES (1, 0, 5, 'free', 6, 1, 0, 'flat');`
    );
    const row: any = await database.getFirstAsync('SELECT enabled, bpm_tolerance, harmonic_mode, crossfade_seconds, cross_out_enabled, volume_normalization, equalizer_preset FROM automix_settings WHERE id = 1;');
    if (row) {
      return {
        enabled: row.enabled !== undefined && row.enabled !== null ? Boolean(row.enabled) : false,
        bpm_tolerance: row.bpm_tolerance !== undefined && row.bpm_tolerance !== null ? Number(row.bpm_tolerance) : 5,
        harmonic_mode: (row.harmonic_mode as any) || 'free',
        crossfade_seconds: Number.isFinite(Number(row.crossfade_seconds))
          ? Math.max(0, Number(row.crossfade_seconds))
          : 6,
        cross_out_enabled: row.cross_out_enabled !== undefined && row.cross_out_enabled !== null ? Boolean(row.cross_out_enabled) : false,
        volume_normalization: row.volume_normalization !== undefined && row.volume_normalization !== null ? Boolean(row.volume_normalization) : false,
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
    crossfade_seconds: 6,
    cross_out_enabled: true,
    volume_normalization: false,
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
    const requestedTransition = Number(updated.crossfade_seconds);
    updated.crossfade_seconds = Number.isFinite(requestedTransition)
      ? Math.min(12, Math.max(0, requestedTransition))
      : 6;
    await database.runAsync(
      `INSERT OR REPLACE INTO automix_settings (id, enabled, bpm_tolerance, harmonic_mode, crossfade_seconds, cross_out_enabled, volume_normalization, equalizer_preset) VALUES (1, ?, ?, ?, ?, ?, ?, ?);`,
      [
        updated.enabled ? 1 : 0,
        updated.bpm_tolerance,
        updated.harmonic_mode,
        updated.crossfade_seconds,
        updated.cross_out_enabled ? 1 : 0,
        updated.volume_normalization ? 1 : 0,
        updated.equalizer_preset || 'flat',
      ]
    );
    return true;
  } catch (error) {
    console.error('[DatabaseService] Error en saveAutoMixSettings:', error);
    return false;
  }
};

export const getAppSetting = async (key: string): Promise<string | null> => {
  if (!key) return null;
  if (Platform.OS === 'web') {
    if (key === 'currentTheme') return webMockTheme;
    return null;
  }

  try {
    const database = await initDatabase();
    const row: any = await database.getFirstAsync('SELECT value FROM app_settings WHERE key = ?;', [key]);
    return typeof row?.value === 'string' ? row.value : null;
  } catch (error) {
    console.warn(`[DatabaseService] No se pudo leer el ajuste ${key}:`, error);
    return null;
  }
};

export const saveAppSetting = async (key: string, value: string): Promise<boolean> => {
  if (!key) return false;
  if (Platform.OS === 'web') {
    if (key === 'currentTheme') webMockTheme = value;
    return true;
  }

  try {
    const database = await initDatabase();
    await database.runAsync(
      'INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?);',
      [key, value]
    );
    return true;
  } catch (error) {
    console.warn(`[DatabaseService] No se pudo guardar el ajuste ${key}:`, error);
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

export const getPlaylists = async (): Promise<PlaylistSummary[]> => {
  if (Platform.OS === 'web') {
    return webMockPlaylists
      .map((playlist) => ({
        ...playlist,
        track_count: webMockPlaylistTracks.get(playlist.id)?.length ?? 0,
      }))
      .sort((a, b) => Number(b.is_system) - Number(a.is_system) || b.updated_at - a.updated_at);
  }
  const database = await initDatabase();
  const rows: any[] = await database.getAllAsync(`
    SELECT p.id, p.name, p.artwork, p.is_system, p.created_at, p.updated_at,
           COUNT(pt.track_id) AS track_count,
           COALESCE(p.artwork, MAX(t.artwork_thumb), MAX(t.artwork)) AS resolved_artwork
    FROM playlists p
    LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
    LEFT JOIN tracks t ON t.id = pt.track_id
    GROUP BY p.id
    ORDER BY p.is_system DESC, p.updated_at DESC, p.name COLLATE NOCASE ASC
  `) || [];
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    artwork: row.resolved_artwork || row.artwork || undefined,
    track_count: Number(row.track_count || 0),
    created_at: Number(row.created_at || 0),
    updated_at: Number(row.updated_at || 0),
    is_system: Boolean(row.is_system),
  }));
};

export const createPlaylist = async (name: string): Promise<PlaylistSummary> => {
  const cleanName = name.trim().replace(/\s+/g, ' ').slice(0, 80);
  if (!cleanName) throw new Error('La playlist necesita un nombre.');
  const now = Date.now();
  const id = `milla:playlist:${now}:${Math.random().toString(36).slice(2, 8)}`;
  if (Platform.OS === 'web') {
    if (webMockPlaylists.some((playlist) => playlist.name.toLowerCase() === cleanName.toLowerCase())) {
      throw new Error('Ya existe una playlist con ese nombre.');
    }
    const playlist = { id, name: cleanName, track_count: 0, created_at: now, updated_at: now };
    webMockPlaylists.push(playlist);
    webMockPlaylistTracks.set(id, []);
    return playlist;
  }
  const database = await initDatabase();
  await database.runAsync(
    'INSERT INTO playlists (id, name, is_system, created_at, updated_at) VALUES (?, ?, 0, ?, ?)',
    [id, cleanName, now, now]
  );
  return { id, name: cleanName, track_count: 0, created_at: now, updated_at: now };
};

export const deletePlaylist = async (playlistId: string): Promise<boolean> => {
  if (!playlistId || playlistId === FAVORITES_PLAYLIST_ID) return false;
  if (Platform.OS === 'web') {
    webMockPlaylists = webMockPlaylists.filter((playlist) => playlist.id !== playlistId);
    webMockPlaylistTracks.delete(playlistId);
    return true;
  }
  const database = await initDatabase();
  const result = await database.runAsync('DELETE FROM playlists WHERE id = ? AND is_system = 0', [playlistId]);
  return result.changes > 0;
};

export const addTrackToPlaylist = async (playlistId: string, trackId: string): Promise<boolean> => {
  if (!playlistId || !trackId) return false;
  if (Platform.OS === 'web') {
    const current = webMockPlaylistTracks.get(playlistId) ?? [];
    if (!current.includes(trackId)) current.push(trackId);
    webMockPlaylistTracks.set(playlistId, current);
    webMockPlaylists = webMockPlaylists.map((playlist) =>
      playlist.id === playlistId ? { ...playlist, updated_at: Date.now() } : playlist
    );
    return true;
  }
  const database = await initDatabase();
  const row: any = await database.getFirstAsync(
    'SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM playlist_tracks WHERE playlist_id = ?',
    [playlistId]
  );
  const now = Date.now();
  await database.runAsync(
    `INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position, added_at)
     VALUES (?, ?, ?, ?)`,
    [playlistId, trackId, Number(row?.next_position ?? 0), now]
  );
  await database.runAsync('UPDATE playlists SET updated_at = ? WHERE id = ?', [now, playlistId]);
  return true;
};

export const removeTrackFromPlaylist = async (playlistId: string, trackId: string): Promise<boolean> => {
  if (!playlistId || !trackId) return false;
  if (Platform.OS === 'web') {
    const current = webMockPlaylistTracks.get(playlistId) ?? [];
    webMockPlaylistTracks.set(playlistId, current.filter((id) => id !== trackId));
    return true;
  }
  const database = await initDatabase();
  const result = await database.runAsync(
    'DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?',
    [playlistId, trackId]
  );
  await database.runAsync('UPDATE playlists SET updated_at = ? WHERE id = ?', [Date.now(), playlistId]);
  return result.changes > 0;
};

export const getPlaylistTracks = async (playlistId: string): Promise<Track[]> => {
  if (!playlistId) return [];
  if (Platform.OS === 'web') {
    const ids = webMockPlaylistTracks.get(playlistId) ?? [];
    const byId = new Map(WEB_MOCK_TRACKS.map((track) => [track.id, track]));
    return ids.map((id) => byId.get(id)).filter((track): track is Track => Boolean(track));
  }
  const database = await initDatabase();
  const rows: any[] = await database.getAllAsync(
    `SELECT ${TRACK_LIST_COLUMNS.split(',').map((column) => `t.${column.trim()}`).join(', ')}
     FROM playlist_tracks pt
     INNER JOIN tracks t ON t.id = pt.track_id
     WHERE pt.playlist_id = ?
     ORDER BY pt.position ASC, pt.added_at ASC`,
    [playlistId]
  ) || [];
  return rows.map(mapTrackRow);
};

export const isTrackFavorite = async (trackId: string): Promise<boolean> => {
  if (!trackId) return false;
  if (Platform.OS === 'web') {
    return (webMockPlaylistTracks.get(FAVORITES_PLAYLIST_ID) ?? []).includes(trackId);
  }
  const database = await initDatabase();
  const row = await database.getFirstAsync(
    'SELECT 1 AS found FROM playlist_tracks WHERE playlist_id = ? AND track_id = ? LIMIT 1',
    [FAVORITES_PLAYLIST_ID, trackId]
  );
  return Boolean(row);
};

export const toggleTrackFavorite = async (trackId: string): Promise<boolean> => {
  const liked = await isTrackFavorite(trackId);
  if (liked) {
    await removeTrackFromPlaylist(FAVORITES_PLAYLIST_ID, trackId);
    return false;
  }
  if (Platform.OS === 'web' && !webMockPlaylists.some((playlist) => playlist.id === FAVORITES_PLAYLIST_ID)) {
    const now = Date.now();
    webMockPlaylists.unshift({
      id: FAVORITES_PLAYLIST_ID,
      name: 'Me encanta',
      track_count: 0,
      created_at: now,
      updated_at: now,
      is_system: true,
    });
  }
  await addTrackToPlaylist(FAVORITES_PLAYLIST_ID, trackId);
  return true;
};

export const saveQueueSnapshot = async (trackIds: string[], activeTrackId?: string): Promise<void> => {
  const payload = JSON.stringify({ trackIds: trackIds.slice(0, 100), activeTrackId, savedAt: Date.now() });
  if (Platform.OS === 'web') return;
  const database = await initDatabase();
  await database.runAsync(
    `INSERT OR REPLACE INTO app_settings (key, value) VALUES ('queue_snapshot', ?)`,
    [payload]
  );
};

export const getQueueSnapshot = async (): Promise<{ trackIds: string[]; activeTrackId?: string } | null> => {
  if (Platform.OS === 'web') return null;
  try {
    const database = await initDatabase();
    const row: any = await database.getFirstAsync("SELECT value FROM app_settings WHERE key = 'queue_snapshot'");
    if (!row?.value) return null;
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed.trackIds) ? parsed : null;
  } catch {
    return null;
  }
};

export const optimizeDatabase = async (): Promise<boolean> => {
  if (Platform.OS === 'web') return true;
  try {
    const database = await initDatabase();
    await database.execAsync('PRAGMA optimize;');
    await database.execAsync('ANALYZE;');
    await database.execAsync('PRAGMA wal_checkpoint(TRUNCATE);');
    await database.execAsync('VACUUM;');
    return true;
  } catch (error) {
    console.error('[DatabaseService] No se pudo optimizar SQLite:', error);
    return false;
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
      `SELECT ${TRACK_LIST_COLUMNS} FROM tracks
       ORDER BY COALESCE(play_count, 0) ASC, COALESCE(last_played, 0) ASC, id ASC 
       LIMIT 50`
    ) || [];

    if (result && result.length > 0) {
      return result.map(mapTrackRow);
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
    const tracks = Platform.OS === 'web'
      ? await getCachedTracks()
      : ((await (await initDatabase()).getAllAsync('SELECT * FROM tracks ORDER BY title COLLATE NOCASE ASC')) || []).map(mapTrackRow);
    const automix = await getAutoMixSettings();
    let appSettings: any[] = [];
    let playlists: any[] = [];
    let playlistTracks: any[] = [];
    if (Platform.OS !== 'web') {
      const database = await initDatabase();
      appSettings = (await database.getAllAsync('SELECT * FROM app_settings')) || [];
      playlists = (await database.getAllAsync('SELECT * FROM playlists')) || [];
      playlistTracks = (await database.getAllAsync('SELECT * FROM playlist_tracks ORDER BY playlist_id, position')) || [];
    } else {
      appSettings = [
        { key: 'currentTheme', value: webMockTheme },
        { key: 'username', value: webMockUsername },
        { key: 'notification_enabled', value: webMockNotification ? 'true' : 'false' }
      ];
      playlists = webMockPlaylists;
      playlistTracks = Array.from(webMockPlaylistTracks.entries()).flatMap(([playlistId, trackIds]) =>
        trackIds.map((trackId, position) => ({
          playlist_id: playlistId,
          track_id: trackId,
          position,
          added_at: Date.now(),
        }))
      );
    }

    const backupPayload = {
      version: '2.0.0',
      app: 'Milla Hi-Res Audio',
      created_at: Date.now(),
      date_iso: new Date().toISOString(),
      data: {
        tracks,
        automix_settings: automix,
        app_settings: appSettings,
        playlists,
        playlist_tracks: playlistTracks,
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
      if (Array.isArray(parsed.data.playlists)) {
        webMockPlaylists = parsed.data.playlists;
      }
      if (Array.isArray(parsed.data.playlist_tracks)) {
        webMockPlaylistTracks.clear();
        for (const row of parsed.data.playlist_tracks) {
          const ids = webMockPlaylistTracks.get(row.playlist_id) || [];
          if (!ids.includes(row.track_id)) ids.push(row.track_id);
          webMockPlaylistTracks.set(row.playlist_id, ids);
        }
      }
      return true;
    }

    if (Array.isArray(parsed.data.tracks)) {
      await insertTracks(parsed.data.tracks.filter((track: Track) => track?.id && track?.url));
    }
    const database = await initDatabase();
    await database.execAsync('BEGIN TRANSACTION;');

    if (Array.isArray(parsed.data.playlists)) {
      for (const playlist of parsed.data.playlists) {
        if (!playlist?.id || !playlist?.name) continue;
        await database.runAsync(
          `INSERT INTO playlists (id, name, artwork, is_system, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             artwork = COALESCE(excluded.artwork, playlists.artwork),
             is_system = excluded.is_system,
             updated_at = excluded.updated_at`,
          [
            playlist.id,
            playlist.name,
            playlist.artwork || null,
            playlist.is_system ? 1 : 0,
            Number(playlist.created_at || Date.now()),
            Number(playlist.updated_at || Date.now()),
          ]
        );
      }
    }

    if (Array.isArray(parsed.data.playlist_tracks)) {
      for (const row of parsed.data.playlist_tracks) {
        if (!row?.playlist_id || !row?.track_id) continue;
        await database.runAsync(
          `INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(playlist_id, track_id) DO UPDATE SET position = excluded.position`,
          [row.playlist_id, row.track_id, Number(row.position || 0), Number(row.added_at || Date.now())]
        );
      }
    }

    if (parsed.data.automix_settings) {
      const am = parsed.data.automix_settings;
      await database.runAsync(
        `INSERT OR REPLACE INTO automix_settings (id, enabled, bpm_tolerance, harmonic_mode, crossfade_seconds, cross_out_enabled, volume_normalization, equalizer_preset) VALUES (1, ?, ?, ?, ?, ?, ?, ?);`,
        [
          am.enabled ? 1 : 0,
          am.bpm_tolerance || 5,
          am.harmonic_mode || 'free',
          am.crossfade_seconds || 0,
          am.cross_out_enabled ? 1 : 0,
          am.volume_normalization ? 1 : 0,
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
