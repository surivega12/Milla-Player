import * as FileSystem from 'expo-file-system';
import jsmediatags from 'jsmediatags';

export interface TrackMetadata {
  title?: string;
  artist?: string;
  album?: string;
  pictureBase64?: string;
  bpm?: number;
  key?: string;
  replayGainTrack?: number;
  replayGainAlbum?: number;
}

export const extractMetadata = async (fileUri: string): Promise<TrackMetadata> => {
  return new Promise((resolve, reject) => {
    jsmediatags.read(fileUri, {
      onSuccess: (tag) => {
        const metadata: TrackMetadata = {};
        const tags = tag.tags;

        if (tags.title) metadata.title = tags.title;
        if (tags.artist) metadata.artist = tags.artist;
        if (tags.album) metadata.album = tags.album;

        // Extraer imagen y convertir a base64
        if (tags.picture) {
          const { data, format } = tags.picture;
          let base64String = '';
          for (let i = 0; i < data.length; i++) {
            base64String += String.fromCharCode(data[i]);
          }
          // Usamos btoa-like logic o buffer (en RN no hay Buffer nativo fácil sin polyfills, btoa via JS base64 es una opción,
          // pero como data es un array de bytes, podemos hacer esto)
          try {
             // Ya que react-native no tiene btoa global por defecto en todos los entornos, usamos una función custom
             const b64 = Buffer.from(data).toString('base64');
             metadata.pictureBase64 = `data:${format};base64,${b64}`;
          } catch(e) {
             // Fallback rudimentario si Buffer no existe
             const b64 = require('react-native').NativeModules.BlobModule ? undefined : undefined; 
             // Mejor evitar Buffer directo si no está polyfilleado. 
             // Expo SDK 50+ tiene btoa global.
             if (typeof btoa === 'function') {
               metadata.pictureBase64 = `data:${format};base64,${btoa(base64String)}`;
             }
          }
        }

        // Parse BPM (TBPM frame in ID3v2)
        if (tags.TBPM?.data) {
          metadata.bpm = parseInt(tags.TBPM.data, 10);
        }

        // Parse Key (TKEY frame in ID3v2)
        if (tags.TKEY?.data) {
          metadata.key = tags.TKEY.data;
        }

        // Parse ReplayGain (TXXX frames or RVA2 in ID3v2)
        if (tags.TXXX) {
          const txxxFrames = Array.isArray(tags.TXXX) ? tags.TXXX : [tags.TXXX];
          txxxFrames.forEach((frame: any) => {
            const desc = frame.user_description?.toUpperCase();
            if (desc === 'REPLAYGAIN_TRACK_GAIN') {
              metadata.replayGainTrack = parseFloat(frame.data.replace(' dB', ''));
            }
            if (desc === 'REPLAYGAIN_ALBUM_GAIN') {
              metadata.replayGainAlbum = parseFloat(frame.data.replace(' dB', ''));
            }
          });
        }

        resolve(metadata);
      },
      onError: (error) => {
        console.warn(`[MetadataService] No se pudieron leer las etiquetas de ${fileUri}:`, error.info);
        resolve({});
      }
    });
  });
};

