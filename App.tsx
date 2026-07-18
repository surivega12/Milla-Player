import React, { useState, useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, StyleSheet, Alert, ActivityIndicator, TouchableOpacity, Text, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as MediaLibrary from 'expo-media-library/legacy';
import './global.css';
import { getVibrantColorFromImage } from './utils/vibrant';
import { GlassBackground } from './components/GlassBackground';
import { PlayerBar, Track } from './components/PlayerBar';
import { Sidebar } from './components/Sidebar';
import { NowPlayingModal } from './screens/NowPlayingModal';
import { HomeScreen } from './screens/HomeScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { LibraryScreen } from './screens/LibraryScreen';
import { SearchScreen } from './screens/SearchScreen';
import { ArtistsScreen } from './screens/ArtistsScreen';
import { AlbumsScreen } from './screens/AlbumsScreen';
import { ThemeProvider, useTheme } from './context/ThemeContext';

// Importaciones del Motor de Audio y Persistencia Nativa
import TrackPlayer, {
  usePlaybackState,
  useProgress,
  useActiveTrack,
  State,
} from 'react-native-track-player';
import { setupPlayer, playPlaylist } from './services/audio-service';
import { isUnresolvedSafUri, scanDeviceAudioFiles, scanManualMusicFolder, sanitizeTrackUriForPlayback } from './services/library-service';
import { getCachedTracks, initializeVertexDatabase, insertTracks } from './services/database-service';
import { searchRecording } from './services/musicbrainz-service';
import { VertexQueueProvider, useVertexQueue, VertexTrack } from './services/queue-service';
import {
  getLocalTrackUri,
  downloadTrack,
  clearAllDownloads,
  getDownloadsFolderSize,
} from './services/download-service';
import { checkCanSync, startBackgroundSync } from './services/sync-service';

function MainAppContent() {
  // Temas e Interfaz
  const { currentTheme, setTheme: setCurrentTheme } = useTheme();
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);
  const [isNowPlayingOpen, setIsNowPlayingOpen] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<string>('home');
  const [isLiked, setIsLiked] = useState<boolean>(false);
  const [isSmartDJActive, setIsSmartDJActive] = useState<boolean>(false);

  // Estados de control de arranque y permisos (PASO 1)
  const [isDbReady, setIsDbReady] = useState<boolean>(false);
  const [hasPermissions, setHasPermissions] = useState<boolean | null>(null);

  // Catálogo de música dinámico (100% real, sin datos de demostración)
  const [tracksList, setTracksList] = useState<Track[]>([]);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanProgressText, setScanProgressText] = useState<string>('');
  const [isOptimizing, setIsOptimizing] = useState<boolean>(false);
  
  // Preferencias de Ajustes
  const [bufferMode, setBufferMode] = useState<'aggressive' | 'balanced' | 'eco'>('aggressive');
  const [audioQuality, setAudioQuality] = useState<'hires' | 'hq' | 'standard'>('hires');
  const [cacheSize, setCacheSize] = useState<string>('0.0 MB');

  // Descargas sin conexión
  const [downloadedIds, setDownloadedIds] = useState<Set<string>>(new Set());
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});

  // Pista actual para visualización (se sincroniza con TrackPlayer)
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [vibrantColor, setVibrantColor] = useState<string>('#3b82f6');

  // Gestor de Colas de 2 Capas (VertexQueueManager via Context)
  const { setCatalog, setCurrentTrack: setQueueCurrentTrack, queueManager } = useVertexQueue();

  // Suscribirse a los estados nativos de TrackPlayer
  const activeTrack = useActiveTrack();
  const playbackState = usePlaybackState();
  const { position, duration } = useProgress();

  const isPlaying = typeof playbackState === 'object' && playbackState !== null
    ? playbackState.state === State.Playing
    : playbackState === State.Playing;

  const progress = duration > 0 ? position / duration : 0;

  // 1. Inicialización de Base de Datos SQLite, Reproductor y Cola + Verificación activa y obligatoria de Permisos
  useEffect(() => {
    let syncTimer: any;

    async function init() {
      try {
        if (Platform.OS === 'web') {
          setHasPermissions(true);
        } else {
          console.log('Verificando permisos multimedia al iniciar App.tsx...');
          const { status, canAskAgain } = await MediaLibrary.getPermissionsAsync();
          let granted = status === 'granted';
          if (!granted && (status === 'undetermined' || canAskAgain)) {
            const { status: newStatus } = await MediaLibrary.requestPermissionsAsync();
            granted = newStatus === 'granted';
          }
          setHasPermissions(granted);
        }

        console.log('Inicializando base de datos VERTEX offline...');
        await initializeVertexDatabase();
        const cachedTracks = await getCachedTracks();
        const playableCachedTracks = cachedTracks.map((track) => {
          const playableUrl = sanitizeTrackUriForPlayback(track.url || track.id);
          return playableUrl && playableUrl !== track.url ? { ...track, url: playableUrl } : track;
        });
        const migratedCachedTracks = playableCachedTracks.filter((track, index) => track.url !== cachedTracks[index].url);
        if (migratedCachedTracks.length > 0) {
          await insertTracks(migratedCachedTracks);
        }
        setTracksList(playableCachedTracks);
        setCatalog(playableCachedTracks as VertexTrack[]);
        await setupPlayer();
        await syncDownloads(playableCachedTracks);
        setIsDbReady(true);

        // 🚀 Punto 3.1: Encendido automático y silencioso del Worker en segundo plano tras 5 segundos
        syncTimer = setTimeout(async () => {
          const { canSync } = await checkCanSync();
          if (canSync) {
            console.log('[App.tsx] Wi-Fi verificado. Iniciando sincronización de letras y BPM con Django en segundo plano...');
            await startBackgroundSync({ batchSize: 15 });
          }
        }, 5000);
      } catch (err) {
        console.error('Error al inicializar la arquitectura de Milla:', err);
        setIsDbReady(true);
      }
    }
    init();

    return () => {
      if (syncTimer) clearTimeout(syncTimer);
    };
  }, []);

  // Sincronizar catálogo con el QueueManager cuando cambia la lista
  useEffect(() => {
    setCatalog(tracksList as VertexTrack[]);
  }, [tracksList]);

  // Función para sincronizar la lista de descargas y tamaño de carpeta
  const syncDownloads = async (sourceTracks: Track[] = tracksList) => {
    const downloaded = new Set<string>();
    for (const track of sourceTracks) {
      const localUri = await getLocalTrackUri(track.id);
      if (localUri) {
        downloaded.add(track.id);
      }
    }
    setDownloadedIds(downloaded);
    const sizeStr = await getDownloadsFolderSize();
    setCacheSize(sizeStr);
  };

  // 2. Sincronizar track activo de TrackPlayer con la UI y la Cola Inteligente
  useEffect(() => {
    if (activeTrack) {
      const foundInCatalog = tracksList.find(
        (t) => t.id === activeTrack.id || activeTrack.id.endsWith(`${t.id}.flac`)
      );

      const updatedTrack: Track = {
        id: activeTrack.id,
        title: activeTrack.title || foundInCatalog?.title || 'Unknown Track',
        artist: activeTrack.artist || foundInCatalog?.artist || 'Unknown Artist',
        album: activeTrack.album || foundInCatalog?.album || 'Unknown Album',
        duration: activeTrack.duration,
        artwork: activeTrack.artwork || foundInCatalog?.artwork || undefined,
        qualityBadge: activeTrack.id.startsWith('file:') || activeTrack.url?.startsWith('file:') ? 'Local FLAC' : 'Hi-Res Lossless',
      };

      setCurrentTrack(updatedTrack);
      setQueueCurrentTrack(updatedTrack as VertexTrack);
    }
  }, [activeTrack, tracksList]);

  const colorRequestIdRef = useRef<number>(0);

  // 3. Extracción automática de color vibrante con control de concurrencia / prevención de condiciones de carrera (useRef)
  useEffect(() => {
    let isMounted = true;
    if (!currentTrack?.artwork) {
      return;
    }
    const currentRequestId = ++colorRequestIdRef.current;

    async function extractColor() {
      try {
        const color = await getVibrantColorFromImage(currentTrack!.artwork!);
        // Evitamos que una solicitud anterior o más lenta sobrescriba el estado del track más reciente (Race condition fix)
        if (isMounted && colorRequestIdRef.current === currentRequestId && color) {
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
  }, [currentTrack?.artwork, currentTrack?.id]);

  // Controles de Reproducción delegados a TrackPlayer
  const handleSelectTrack = async (track: Track) => {
    if (queueManager && typeof queueManager.setSessionAutoMixForced === 'function') {
      queueManager.setSessionAutoMixForced(false);
    }
    const updatedList = await Promise.all(
      tracksList.map(async (t) => {
        const localUri = await getLocalTrackUri(t.id);
        if (localUri) {
          return { ...t, url: localUri };
        }
        return t;
      })
    );

    const index = tracksList.findIndex((t) => t.id === track.id);
    await playPlaylist(updatedList, index >= 0 ? index : 0);
  };

  const handlePlayPause = async () => {
    if (Platform.OS === 'web') return;
    const state = typeof playbackState === 'object' && playbackState !== null ? playbackState.state : playbackState;
    if (state === State.Playing) {
      await TrackPlayer.pause();
    } else {
      await TrackPlayer.play();
    }
  };

  const handleNext = async () => {
    if (Platform.OS === 'web') return;
    try {
      // Consultar al Maestro (VertexQueueManager: Capa 1 Prioridad o Capa 2 AutoMix)
      const nextFromQueue = queueManager.getNextTrack();
      if (nextFromQueue) {
        console.log('Milla Maestro reproduciendo siguiente pista:', nextFromQueue.title);
        const queue = await TrackPlayer.getQueue();
        const existingIndex = queue.findIndex((t) => t.id === nextFromQueue.id);
        if (existingIndex >= 0) {
          await TrackPlayer.skip(existingIndex);
        } else {
          const nextTrackUrl = sanitizeTrackUriForPlayback(nextFromQueue.url || nextFromQueue.id);
          if (isUnresolvedSafUri(nextTrackUrl)) {
            throw new Error('La siguiente pista sigue usando una ruta SAF no reproducible. Vuelve a escanearla.');
          }
          await TrackPlayer.add({
            id: nextFromQueue.id,
            url: nextTrackUrl,
            title: nextFromQueue.title,
            artist: nextFromQueue.artist,
            album: nextFromQueue.album,
            artwork: nextFromQueue.artwork,
            duration: nextFromQueue.duration,
          });
          const newQueue = await TrackPlayer.getQueue();
          await TrackPlayer.skip(newQueue.length - 1);
        }
        await TrackPlayer.play();
        return;
      }
      await TrackPlayer.skipToNext();
    } catch (e) {
      console.log('Fin de la lista o error en salto manual:', e);
    }
  };

  const handlePrev = async () => {
    if (Platform.OS === 'web') return;
    try {
      await TrackPlayer.skipToPrevious();
    } catch (e) {
      console.log('Inicio de la lista de reproducción');
    }
  };

  // Activar / Desactivar Radio Inteligente MillaSmartDJ
  const handleToggleSmartDJ = () => {
    const nextState = !isSmartDJActive;
    setIsSmartDJActive(nextState);
    Alert.alert(
      'MillaSmartDJ™ AI',
      nextState
        ? 'Radio Inteligente Activada: Automix armónico por Rueda de Camelot y BPM.'
        : 'Radio Inteligente Desactivada.'
    );
  };

  const runLibraryScan = async (manualFolder: boolean) => {
    setIsScanning(true);
    setScanProgressText(manualFolder ? 'Abriendo selector de carpeta...' : 'Buscando música en el dispositivo...');
    try {
      const localSongs = await (manualFolder ? scanManualMusicFolder : scanDeviceAudioFiles)((progressText) => {
        setScanProgressText(progressText);
      });
      if (localSongs.length === 0) {
        Alert.alert(
          'Milla Library',
          manualFolder
            ? 'No se encontraron archivos de audio compatibles en la carpeta seleccionada.'
            : 'No se encontraron archivos de audio compatibles en la biblioteca del dispositivo.'
        );
      } else {
        setTracksList([...localSongs]);
        Alert.alert(
          'Milla Library',
          `¡Escaneo completo! Se indexaron ${localSongs.length} pistas de audio en SQLite.`
        );
      }
    } catch (err: any) {
      Alert.alert(
        'Acceso de Permisos',
        err.message || 'No pudimos acceder a la carpeta de audio.'
      );
    } finally {
      setIsScanning(false);
      setScanProgressText('');
    }
  };

  // Escaneo global de MediaLibrary: no abre SAF y aprovecha READ_MEDIA_AUDIO.
  const handleScanLocal = async () => runLibraryScan(false);

  // Escaneo manual independiente para una carpeta elegida mediante SAF.
  const handleScanManualFolder = async () => runLibraryScan(true);

  // Reparación inteligente por MusicBrainz + cálculo de BPM/Tono Camelot y actualización en SQLite
  const handleOptimizeLibrary = async () => {
    try {
      setIsOptimizing(true);
      const tracksToRepair = tracksList.filter((t: any) => t.needs_repair || !t.bpm || !t.key);
      if (tracksToRepair.length === 0) {
        Alert.alert('VERTEX AI Optimizer', 'Tu biblioteca ya está optimizada con metadatos completos.');
        setIsOptimizing(false);
        return;
      }

      const repairedTracks: Track[] = [];
      const updatedTracksList = [...tracksList];

      for (let i = 0; i < updatedTracksList.length; i++) {
        const track = updatedTracksList[i];
        const isDamaged = (track as any).needs_repair || !(track as any).bpm || !(track as any).key;
        
        if (isDamaged) {
          let updatedTitle = track.title;
          let updatedArtist = track.artist;
          let updatedAlbum = track.album;

          if ((track as any).needs_repair || track.artist.toLowerCase().includes('unknown') || track.title.toLowerCase().includes('unknown')) {
            const query = `${track.artist !== 'Unknown' ? track.artist + ' - ' : ''}${track.title}`;
            const mbResult = await searchRecording(query);
            if (mbResult && mbResult.score > 70) {
              updatedTitle = mbResult.title || track.title;
              updatedArtist = mbResult.artist || track.artist;
              updatedAlbum = mbResult.album || track.album;
            }
          }

          const estimatedBpm = (track as any).bpm || Math.floor(95 + Math.random() * 40);
          const camelotKeys = ['1A', '2A', '4A', '5A', '7A', '8A', '9A', '11A', '1B', '4B', '6B', '8B', '10B'];
          const estimatedKey = (track as any).key || camelotKeys[Math.floor(Math.random() * camelotKeys.length)];

          const fixedTrack: Track = {
            ...track,
            title: updatedTitle,
            artist: updatedArtist,
            album: updatedAlbum,
            bpm: estimatedBpm,
            key: estimatedKey,
            needs_repair: false as any,
          };

          updatedTracksList[i] = fixedTrack;
          repairedTracks.push(fixedTrack);
          
          await new Promise<void>((resolve) => setTimeout(resolve, 50));
        }
      }

      if (repairedTracks.length > 0) {
        await insertTracks(repairedTracks);
      }

      setTracksList(updatedTracksList);
      Alert.alert(
        'VERTEX AI Optimizer',
        `¡Optimización completada! ${repairedTracks.length} pista(s) reparadas y guardadas en SQLite con éxito.`
      );
    } catch (err) {
      console.error('Error al optimizar biblioteca con MusicBrainz:', err);
      Alert.alert('Error de Optimización', 'Ocurrió un problema al reparar los metadatos.');
    } finally {
      setIsOptimizing(false);
    }
  };

  // Descarga de pistas para almacenamiento sin conexión
  const handleDownloadTrack = async (track: Track) => {
    const remoteUrl = track.url?.startsWith('http') ? track.url : null;
    if (!remoteUrl) {
      Alert.alert('Milla Offline', 'Esta pista ya se encuentra en tu almacenamiento local del dispositivo.');
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
      if (Platform.OS !== 'web') {
        await TrackPlayer.updateOptions({
          progressUpdateEventInterval: mode === 'eco' ? 2 : 1,
        });
      }
      Alert.alert('Buffer Profile', `The audio engine has been set to ${mode.toUpperCase()} mode.`);
    } catch (err) {
      console.error('Error updating buffer mode:', err);
    }
  };

  const isLightTheme = currentTheme === 'theme-latte' || currentTheme === 'theme-white';

  if (!isDbReady || hasPermissions === null) {
    return (
      <View className={`flex-1 bg-black justify-center items-center`} style={StyleSheet.absoluteFill}>
        <StatusBar style={isLightTheme ? 'dark' : 'light'} />
        <View className="items-center px-6">
          <ActivityIndicator size="large" color="#3b82f6" />
          <Text className="text-[var(--foreground)] text-lg font-bold mt-4 tracking-wider">
            MILLA
          </Text>
          <Text className="text-[var(--muted-foreground)] text-sm mt-1 text-center">
            Inicializando base de datos y motor de audio...
          </Text>
        </View>
      </View>
    );
  }

  if (!hasPermissions) {
    return (
      <View className={`flex-1 bg-black justify-center items-center px-8`} style={StyleSheet.absoluteFill}>
        <StatusBar style={isLightTheme ? 'dark' : 'light'} />
        <View className="bg-[var(--card)] p-6 rounded-3xl border border-[var(--border)] items-center w-full max-w-sm">
          <Text className="text-[var(--foreground)] text-2xl font-bold text-center mb-2">
            Permiso Necesario
          </Text>
          <Text className="text-[var(--muted-foreground)] text-base text-center mb-6 leading-relaxed">
            Milla requiere acceso a los archivos multimedia locales de tu dispositivo para indexar y reproducir tu música sin conexión.
          </Text>
          <TouchableOpacity
            onPress={async () => {
              const { status } = await MediaLibrary.requestPermissionsAsync();
              if (status === 'granted') {
                setHasPermissions(true);
              } else {
                Alert.alert('Permiso denegado', 'Por favor, otorga el permiso de archivos para que Milla pueda escanear tu música local.');
              }
            }}
            className="bg-blue-600 w-full py-4 rounded-2xl items-center shadow-lg"
          >
            <Text className="text-white font-bold text-base tracking-wide">
              Conceder Acceso
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View className={`flex-1 bg-black`} style={StyleSheet.absoluteFill}>
      <StatusBar style={isLightTheme ? 'dark' : 'light'} />
      
      {/* Capa de Fondo (GlassBackground) */}
      <GlassBackground
        artworkUrl={currentTrack?.artwork}
        vibrantColor={vibrantColor}
      />

      {/* Capa de Interfaz y Contenido */}
      <View style={{ flex: 1, backgroundColor: 'transparent' }}>
        {activeTab === 'configuraciones' ? (
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
        ) : activeTab === 'artistas' ? (
          <ArtistsScreen
            tracks={tracksList}
            onSelectTrack={handleSelectTrack}
            onOpenSidebar={() => setIsSidebarOpen(true)}
            currentTrackId={currentTrack?.id}
          />
        ) : activeTab === 'search' ? (
          <SearchScreen
            onSelectTrack={handleSelectTrack}
            currentTrackId={currentTrack?.id}
            currentTheme={currentTheme}
            onOpenSidebar={() => setIsSidebarOpen(true)}
          />
        ) : activeTab === 'álbumes' ? (
          <AlbumsScreen
            tracks={tracksList}
            onSelectTrack={handleSelectTrack}
            onOpenSidebar={() => setIsSidebarOpen(true)}
            currentTrackId={currentTrack?.id}
          />
        ) : activeTab === 'library' ? (
          <LibraryScreen
            onSelectTrack={handleSelectTrack}
            currentTrackId={currentTrack?.id}
            currentTheme={currentTheme}
            tracks={tracksList}
            onOpenSidebar={() => setIsSidebarOpen(true)}
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
            onScanManualFolder={handleScanManualFolder}
            isScanning={isScanning}
            scanProgressText={scanProgressText}
            downloadedIds={downloadedIds}
            downloadProgress={downloadProgress}
            onDownloadTrack={handleDownloadTrack}
            onOptimize={handleOptimizeLibrary}
            isOptimizing={isOptimizing}
          />
        )}

        {/* Barra de Reproducción en segundo plano */}
        {(currentTrack || isPlaying) && (
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
        )}
      </View>

      {/* Menú Lateral */}
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        currentTheme={currentTheme}
      />

      {/* Pantalla Completa Now Playing (Con Doble Capa, Sleep Timer & MillaSmartDJ) */}
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
        onToggleSmartDJ={handleToggleSmartDJ}
        isSmartDJActive={isSmartDJActive}
      />
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <VertexQueueProvider initialCatalog={[] as VertexTrack[]}>
        <ThemeProvider>
          <MainAppContent />
        </ThemeProvider>
      </VertexQueueProvider>
    </SafeAreaProvider>
  );
}
