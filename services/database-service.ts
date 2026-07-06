import * as SQLite from 'expo-sqlite';
import { Track } from '../components/PlayerBar';

// Singleton de la base de datos
let db: SQLite.SQLiteDatabase | null = null;

export const initDatabase = async (): Promise<SQLite.SQLiteDatabase> => {
  if (db) return db;

  db = await SQLite.openDatabaseAsync('milla.db');
  
  // Crear tabla principal de pistas con caché y metadata extendida
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT,
      duration INTEGER NOT NULL,
      artwork TEXT,
      artwork_thumb TEXT,
      bpm INTEGER,
      key TEXT,
      replayGainTrack REAL,
      replayGainAlbum REAL,
      qualityBadge TEXT,
      needs_repair INTEGER DEFAULT 0
    );
  `);
  
  return db;
};

// Funciones de utilidad para CRUD rápido
export const getCachedTracks = async (): Promise<Track[]> => {
  const database = await initDatabase();
  const result = await database.getAllAsync<any>('SELECT * FROM tracks');
  
  // Mapeamos de vuelta al formato Track que usa la UI y TrackPlayer
  return result.map(row => ({
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
    replayGainTrack: row.replayGainTrack,
    replayGainAlbum: row.replayGainAlbum,
    qualityBadge: row.qualityBadge,
    needs_repair: Boolean(row.needs_repair),
  }));
};

export const insertTracks = async (tracks: Track[]) => {
  if (tracks.length === 0) return;
  const database = await initDatabase();
  
  const statement = await database.prepareAsync(`
    INSERT OR REPLACE INTO tracks (
      id, url, title, artist, album, duration, artwork, artwork_thumb, 
      bpm, key, replayGainTrack, replayGainAlbum, qualityBadge, needs_repair
    ) VALUES ($id, $url, $title, $artist, $album, $duration, $artwork, $artwork_thumb, $bpm, $key, $replayGainTrack, $replayGainAlbum, $qualityBadge, $needs_repair)
  `);

  try {
    for (const t of tracks) {
      await statement.executeAsync({
        $id: t.id,
        $url: t.url,
        $title: t.title,
        $artist: t.artist,
        $album: t.album || null,
        $duration: t.duration || 0,
        $artwork: t.artwork || null,
        $artwork_thumb: t.artwork_thumb || null,
        $bpm: t.bpm || null,
        $key: t.key || null,
        $replayGainTrack: t.replayGainTrack || null,
        $replayGainAlbum: t.replayGainAlbum || null,
        $qualityBadge: t.qualityBadge || null,
        $needs_repair: (t as any).needs_repair ? 1 : 0
      });
    }
  } finally {
    await statement.finalizeAsync();
  }
};

export const deleteTracks = async (ids: string[]) => {
  if (ids.length === 0) return;
  const database = await initDatabase();
  const placeholders = ids.map(() => '?').join(',');
  await database.runAsync(`DELETE FROM tracks WHERE id IN (${placeholders})`, ids);
};
