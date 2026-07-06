import React, { useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, View, StyleSheet, Alert } from 'react-native';
import './global.css';
import { getVibrantColorFromImage } from './utils/vibrant';
import { GlassBackground } from './components/GlassBackground';
import { PlayerBar, Track } from './components/PlayerBar';
import { Sidebar } from './components/Sidebar';
import { NowPlayingModal } from './components/NowPlayingModal';
import { HomeScreen, SAMPLE_CATALOG } from './screens/HomeScreen';
import { SettingsScreen } from './screens/SettingsScreen';

// Importaciones del Motor de Audio Nativo
import TrackPlayer, {
  usePlaybackState,
  useProgress,
  useActiveTrack,
  State,
} from 'react-native-track-player';
import { setupPlayer, playPlaylist } from './services/audio-service';
import { scanLocalAudioFiles } from './services/library-service';
import {
  getLocalTrackUri,
  downloadTrack,
  clearAllDownloads,
  getDownloadsFolderSize,
} from './services/download-service';

export default function App() {
  // Temas e Interfaz
  const [currentTheme, setCurrentTheme] = useState<string>('theme-monochrome');
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);
  const [isNowPlayingOpen, setIsNowPlayingOpen] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<string>('home');
  const [isLiked, setIsLiked] = useState<boolean>(false);

  // Catálogo de música dinámico
  const [tracksList, setTracksList] = useState<Track[]>(SAMPLE_CATALOG);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  
  // Preferencias de Ajustes
  const [bufferMode, setBufferMode] = useState<'aggressive' | 'balanced' | 'eco'>('aggressive');
  const [audioQuality, setAudioQuality] = useState<'hires' | 'hq' | 'standard'>('hires');
  const [cacheSize, setCacheSize] = useState<string>('0.0 MB');

  // Descargas sin conexión
  const [downloadedIds, setDownloadedIds] = useState<Set<string>>(new Set());
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});

  // Pista actual para visualización (se sincroniza con TrackPlayer)
  const [currentTrack, setCurrentTrack] = useState<Track | null>(SAMPLE_CATALOG[0]);
  const [vibrantColor, setVibrantColor] = useState<string>('#3b82f6');

  // Suscribirse a los estados nativos de TrackPlayer
  const activeTrack = useActiveTrack();
  const playbackState = usePlaybackState();
  const { position, duration } = useProgress();

  // Calcular si está reproduciendo activamente
  const isPlaying = typeof playbackState === 'object' && playbackState !== null
    ? playbackState.state === State.Playing
    : playbackState === State.Playing;

  // Calcular el progreso decimal (0.0 a 1.0)
  const progress = duration > 0 ? position / duration : 0;

  // 1. Inicialización en el montaje del componente
  useEffect(() => {
    async function init() {
      try {
        await setupPlayer();
        await syncDownloads();
      } catch (err) {
        console.error('Error al inicializar el reproductor de audio:', err);
      }
    }
    init();
  }, []);

  // Función para sincronizar la lista de descargas y tamaño de carpeta
  const syncDownloads = async () => {
    const downloaded = new Set<string>();
    for (const track of SAMPLE_CATALOG) {
      const localUri = await getLocalTrackUri(track.id);
      if (localUri) {
        downloaded.add(track.id);
      }
    }
    setDownloadedIds(downloaded);
    const sizeStr = await getDownloadsFolderSize();
    setCacheSize(sizeStr);
  };

  // 2. Sincronizar track activo de TrackPlayer con la UI
  useEffect(() => {
    if (activeTrack) {
      // Buscar si el track pertenece al catálogo por el ID del archivo o demo
      const foundInCatalog = tracksList.find(
        (t) => t.id === activeTrack.id || activeTrack.id.endsWith(`${t.id}.flac`)
      );

      setCurrentTrack({
        id: activeTrack.id,
        title: activeTrack.title || foundInCatalog?.title || 'Unknown Track',
        artist: activeTrack.artist || foundInCatalog?.artist || 'Unknown Artist',
        album: activeTrack.album || foundInCatalog?.album || 'Unknown Album',
        duration: activeTrack.duration,
        artwork: activeTrack.artwork || foundInCatalog?.artwork || 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=300',
        qualityBadge: activeTrack.id.startsWith('http') ? 'FLAC 24-bit/192kHz' : 'Local Lossless',
      });
    }
  }, [activeTrack, tracksList]);

  // 3. Extracción automática de color vibrante
  useEffect(() => {
    let isMounted = true;
    async function extractColor() {
      if (!currentTrack?.artwork) {
        return;
      }
      try {
        const color = await getVibrantColorFromImage(currentTrack.artwork);
        if (isMounted && color) {
          setVibrantColor(color);
        }
      } catch (err) {
        console.error('Error al extraer color vibrante en App.tsx:', err);
      }
    }
    extractColor();
    return () => {
      isMounted = false;
    };
  }, [currentTrack]);

  // Controles de Reproducción delegados a TrackPlayer
  const handleSelectTrack = async (track: Track) => {
    // Sincronizar/mapear toda la lista de canciones usando archivos locales si están descargados
    const updatedList = await Promise.all(
      tracksList.map(async (t) => {
        const localUri = await getLocalTrackUri(t.id);
        if (localUri) {
          return { ...t, id: localUri }; // Reemplazar la ID con la URI local para reproducción sin conexión
        }
        return t;
      })
    );

    const index = tracksList.findIndex((t) => t.id === track.id);
    await playPlaylist(updatedList, index >= 0 ? index : 0);
  };

  const handlePlayPause = async () => {
    const state = typeof playbackState === 'object' && playbackState !== null ? playbackState.state : playbackState;
    if (state === State.Playing) {
      await TrackPlayer.pause();
    } else {
      await TrackPlayer.play();
    }
  };

  const handleNext = async () => {
    try {
      await TrackPlayer.skipToNext();
    } catch (e) {
      console.log('Fin de la lista de reproducción');
    }
  };

  const handlePrev = async () => {
    try {
      await TrackPlayer.skipToPrevious();
    } catch (e) {
      console.log('Inicio de la lista de reproducción');
    }
  };

  // Escáner nativo de música local
  const handleScanLocal = async () => {
    setIsScanning(true);
    try {
      const localSongs = await scanLocalAudioFiles();
      if (localSongs.length === 0) {
        Alert.alert(
          'Milla Library',
          'No se encontraron archivos de audio locales en tu dispositivo. Se mantendrán las canciones de demostración.'
        );
      } else {
        setTracksList([...localSongs, ...SAMPLE_CATALOG]);
        Alert.alert(
          'Milla Library',
          `¡Escaneo completo! Se añadieron ${localSongs.length} archivos de audio locales.`
        );
      }
    } catch (err: any) {
      Alert.alert(
        'Acceso de Permisos',
        err.message || 'No pudimos acceder a los archivos multimedia.'
      );
    } finally {
      setIsScanning(false);
    }
  };

  // Descarga de pistas para almacenamiento sin conexión
  const handleDownloadTrack = async (track: Track) => {
    const demoUrls: Record<string, string> = {
      'track-1': 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
      'track-2': 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
      'track-3': 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
      'track-4': 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3',
      'track-5': 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3',
      'track-6': 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3',
    };

    const remoteUrl = demoUrls[track.id];
    if (!remoteUrl) {
      Alert.alert('Milla Offline', 'Esta pista ya es local o no se puede descargar.');
      return;
    }

    setDownloadProgress((prev) => ({ ...prev, [track.id]: 0 }));

    try {
      await downloadTrack(track.id, remoteUrl, (progressVal) => {
        setDownloadProgress((prev) => ({ ...prev, [track.id]: progressVal }));
      });
      await syncDownloads();
      Alert.alert('Milla Offline', `"${track.title}" se ha descargado y está disponible sin conexión.`);
    } catch (err) {
      Alert.alert('Descarga Fallida', 'No se pudo completar la descarga. Verifica tu conexión.');
    } finally {
      setDownloadProgress((prev) => {
        const next = { ...prev };
        delete next[track.id];
        return next;
      });
    }
  };

  // Limpiar descargas
  const handleClearCache = async () => {
    try {
      await clearAllDownloads();
      await syncDownloads();
      Alert.alert('Storage Cleaned', 'All offline tracks deleted successfully.');
    } catch (err) {
      Alert.alert('Storage Error', 'Could not clear files.');
    }
  };

  // Cambiar perfil de búfer nativo
  const handleSelectBufferMode = async (mode: 'aggressive' | 'balanced' | 'eco') => {
    setBufferMode(mode);
    try {
      await TrackPlayer.updateOptions({
        progressUpdateEventInterval: mode === 'eco' ? 2 : 1,
      });
      Alert.alert('Buffer Profile', `The audio engine has been set to ${mode.toUpperCase()} mode.`);
    } catch (err) {
      console.error('Error updating buffer mode:', err);
    }
  };

  const isLightTheme = currentTheme === 'theme-latte' || currentTheme === 'theme-white';

  return (
    <View className={`${currentTheme} flex-1 bg-[var(--background)]`} style={StyleSheet.absoluteFill}>
      <StatusBar style={isLightTheme ? 'dark' : 'light'} />
      
      {/* Capa de Fondo (GlassBackground) */}
      <GlassBackground
        artworkUrl={currentTrack?.artwork}
        vibrantColor={vibrantColor}
      />

      {/* Capa de Interfaz y Contenido */}
      <SafeAreaView style={{ flex: 1 }}>
        {activeTab === 'settings' ? (
          <SettingsScreen
            onOpenSidebar={() => setIsSidebarOpen(true)}
            currentTheme={currentTheme}
            onSelectTheme={setCurrentTheme}
            bufferMode={bufferMode}
            onSelectBufferMode={handleSelectBufferMode}
            audioQuality={audioQuality}
            onSelectAudioQuality={setAudioQuality}
            onClearCache={handleClearCache}
            cacheSize={cacheSize}
          />
        ) : (
          <HomeScreen
            onOpenSidebar={() => setIsSidebarOpen(true)}
            onSelectTrack={handleSelectTrack}
            currentTrackId={currentTrack?.id}
            currentTheme={currentTheme}
            onSelectTheme={setCurrentTheme}
            tracks={tracksList}
            onScanLocal={handleScanLocal}
            isScanning={isScanning}
            downloadedIds={downloadedIds}
            downloadProgress={downloadProgress}
            onDownloadTrack={handleDownloadTrack}
          />
        )}

        {/* Barra de Reproducción en segundo plano */}
        <PlayerBar
          track={currentTrack}
          isPlaying={isPlaying}
          progress={progress}
          currentTheme={currentTheme}
          isLiked={isLiked}
          onPlayPause={handlePlayPause}
          onNext={handleNext}
          onPrev={handlePrev}
          onToggleLike={() => setIsLiked(!isLiked)}
          onPressBar={() => setIsNowPlayingOpen(true)}
        />
      </SafeAreaView>

      {/* Menú Lateral */}
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        currentTheme={currentTheme}
      />

      {/* Pantalla Completa Now Playing */}
      <NowPlayingModal
        isOpen={isNowPlayingOpen}
        onClose={() => setIsNowPlayingOpen(false)}
        track={currentTrack}
        isPlaying={isPlaying}
        progress={progress}
        currentTheme={currentTheme}
        isLiked={isLiked}
        onPlayPause={handlePlayPause}
        onNext={handleNext}
        onPrev={handlePrev}
        onToggleLike={() => setIsLiked(!isLiked)}
      />
    </View>
  );
}
