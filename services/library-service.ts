import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import { Track } from '../components/PlayerBar';
import { extractMetadata } from './metadata-service';
import { getCachedTracks, insertTracks, deleteTracks } from './database-service';

export async function requestLibraryPermission(): Promise<boolean> {
  const { status, canAskAgain } = await MediaLibrary.getPermissionsAsync();
  if (status === 'granted') return true;
  if (status === 'undetermined' || canAskAgain) {
    const { status: newStatus } = await MediaLibrary.requestPermissionsAsync();
    return newStatus === 'granted';
  }
  return false;
}

function getFileQualityBadge(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === 'flac') return 'FLAC Lossless';
  if (ext === 'wav') return 'WAV Lossless';
  if (ext === 'dsf' || ext === 'dff') return 'DSD Direct';
  if (ext === 'm4a') return 'AAC Audio';
  return 'MP3 Audio';
}

const generateThumbnail = async (base64Image: string, trackId: string): Promise<{ original: string, thumb: string } | null> => {
  try {
    const safeId = trackId.replace(/[^a-z0-9]/gi, '_');
    const originalUri = FileSystem.documentDirectory + `${safeId}_original.jpg`;
    
    // Save base64 as original image
    const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, '');
    await FileSystem.writeAsStringAsync(originalUri, base64Data, { encoding: FileSystem.EncodingType.Base64 });

    // Generate lightweight thumbnail
    const result = await ImageManipulator.manipulateAsync(
      originalUri,
      [{ resize: { width: 150 } }], // Minify to 150px width for fast rendering
      { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG }
    );

    return {
      original: originalUri,
      thumb: result.uri
    };
  } catch (error) {
    console.warn('[LibraryService] Failed to generate thumbnail:', error);
    return null;
  }
};

export async function scanLocalAudioFiles(): Promise<Track[]> {
  const hasPermission = await requestLibraryPermission();
  if (!hasPermission) {
    throw new Error('Permisos para acceder a la biblioteca multimedia denegados.');
  }

  // 1. Obtener canciones cacheadas de SQLite
  const cachedTracks = await getCachedTracks();
  const cachedIds = new Set(cachedTracks.map(t => t.id));

  // 2. Obtener TODAS las canciones del dispositivo
  const media = await MediaLibrary.getAssetsAsync({
    mediaType: MediaLibrary.MediaType.AUDIO,
    first: 1000,
  });

  const validAssets = media.assets.filter(asset => asset.duration > 30);
  const currentAssetIds = new Set(validAssets.map(a => a.uri));

  // 3. Detectar pistas eliminadas
  const deletedIds = cachedTracks.filter(t => !currentAssetIds.has(t.id)).map(t => t.id);
  if (deletedIds.length > 0) {
    await deleteTracks(deletedIds);
  }

  // 4. Detectar pistas nuevas
  const newAssets = validAssets.filter(asset => !cachedIds.has(asset.uri));
  
  if (newAssets.length > 0) {
    const newTracks: Track[] = [];
    
    for (const asset of newAssets) {
      // Leer metadatos SOLO para archivos nuevos
      const meta = await extractMetadata(asset.uri);
      
      let title = meta.title || asset.filename.replace(/\.[^/.]+$/, '').replace(/_/g, ' ');
      let artist = meta.artist || 'Unknown';
      let needsRepair = false;

      // Lógica de detección de etiquetas corruptas
      if (!meta.title || !meta.artist || meta.artist.toLowerCase().includes('unknown')) {
        needsRepair = true;
      }

      let artworkUri = 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=300&auto=format&fit=crop';
      let thumbUri = artworkUri;

      if (meta.pictureBase64) {
        const images = await generateThumbnail(meta.pictureBase64, asset.uri);
        if (images) {
          artworkUri = images.original;
          thumbUri = images.thumb;
        }
      }

      newTracks.push({
        id: asset.uri,
        url: asset.uri,
        title,
        artist,
        album: meta.album || 'Device Music',
        duration: Math.round(asset.duration),
        qualityBadge: getFileQualityBadge(asset.filename),
        artwork: artworkUri,
        artwork_thumb: thumbUri,
        bpm: meta.bpm,
        key: meta.key,
        replayGainTrack: meta.replayGainTrack,
        replayGainAlbum: meta.replayGainAlbum,
        needs_repair: needsRepair as any // Cast temporal para el tipo extendido
      });
    }

    // Insertar nuevas pistas procesadas en la base de datos
    await insertTracks(newTracks);
  }

  // Retornar la lista final desde SQLite para garantizar consistencia
  return await getCachedTracks();
}
