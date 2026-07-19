import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, StyleSheet, Alert, ActivityIndicator, TouchableOpacity, Text, Platform, BackHandler } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
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
import { PlaylistsScreen } from './screens/PlaylistsScreen';
import { PlaylistPickerModal } from './components/PlaylistPickerModal';
import { CollectionDetailView } from './components/CollectionDetailView';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { ThemeProvider, useTheme } from './context/ThemeContext';

// Importaciones del Motor de Audio y Persistencia Nativa
import TrackPlayer, {
  usePlaybackState,
  useActiveTrack,
  State,
} from './services/player-engine';
import { configureAutoMixQueue, playPlaylist } from './services/audio-service';
import { ensureTrackPlayableUri, getLibraryPermissionStatus, hydrateTrackMetadataForPlayback, isTrackPlayerCompatibleUri, requestLibraryPermission, scanDeviceAudioFiles, scanManualMusicFolder } from './services/library-service';
import { getAutoMixSettings, getCachedTracks, initializeVertexDatabase, insertTracks, isTrackFavorite, saveAutoMixSettings, toggleTrackFavorite } from './services/database-service';
import { searchRecording } from './services/musicbrainz-service';
import { VertexQueueProvider, useVertexQueue, VertexTrack } from './services/queue-service';
import {
  getLocalTrackUri,
  downloadTrack,
  clearAllDownloads,
  getDownloadsFolderSize,
} from './services/download-service';
import { analyzeLibraryAudio, checkCanSync, startBackgroundSync } from './services/sync-service';

function MainAppContent() {
  // Temas e Interfaz
  const { currentTheme, setTheme: setCurrentTheme, colors } = useTheme();
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);
  const [isNowPlayingOpen, setIsNowPlayingOpen] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<string>('home');
  const [isLiked, setIsLiked] = useState<boolean>(false);
  const [isSmartDJActive, setIsSmartDJActive] = useState<boolean>(false);
  const [lyricsRequestNonce, setLyricsRequestNonce] = useState<number>(0);
  const [queueRequestNonce, setQueueRequestNonce] = useState<number>(0);
  const [sleepTimerRequestNonce, setSleepTimerRequestNonce] = useState<number>(0);
  const [playlistPickerTrack, setPlaylistPickerTrack] = useState<Track | null>(null);
  const [collectionTarget, setCollectionTarget] = useState<{
    kind: 'artist' | 'album';
    title: string;
    subtitle?: string;
    artwork?: string;
    tracks: Track[];
  } | null>(null);
  const tabHistoryRef = useRef<string[]>(['home']);

  // Estados de control de arranque y permisos (PASO 1)
  const [isDbReady, setIsDbReady] = useState<boolean>(false);
  const [hasPermissions, setHasPermissions] = useState<boolean | null>(null);
  const [isRequestingPermission, setIsRequestingPermission] = useState(false);

  // Catálogo de música dinámico (100% real, sin datos de demostración)
  const [tracksList, setTracksList] = useState<Track[]>([]);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanProgressText, setScanProgressText] = useState<string>('');
  const [isOptimizing, setIsOptimizing] = useState<boolean>(false);
  const [optimizationProgressText, setOptimizationProgressText] = useState<string>('');
  
  // Preferencias de Ajustes
  const [bufferMode, setBufferMode] = useState<'aggressive' | 'balanced' | 'eco'>('aggressive');
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

  const isPlaying = typeof playbackState === 'object' && playbackState !== null
    ? playbackState.state === State.Playing
    : playbackState === State.Playing;

  const progress = 0;
  const tracksById = useMemo(
    () => new Map(tracksList.map((track) => [track.id, track])),
    [tracksList]
  );

  // 1. Inicialización de Base de Datos SQLite, Reproductor y Cola + Verificación activa y obligatoria de Permisos
  useEffect(() => {
    let syncTimer: any;

    async function init() {
      try {
        await initializeVertexDatabase();
        const cachedTracks = await getCachedTracks();
        setTracksList(cachedTracks);
        setCatalog(cachedTracks as VertexTrack[]);
        const autoMixSettings = await getAutoMixSettings();
        await queueManager.syncSettings();
        setIsSmartDJActive(autoMixSettings.enabled);
        // Keep boot independent from the native audio service. TrackPlayer is
        // initialized by playPlaylist after an intentional user action, which
        // prevents an Android media-session failure from taking down the
        // library immediately after the permission dialog.
        setIsDbReady(true);
        // Android only opens the system dialog from the explicit button below.
        setHasPermissions(await getLibraryPermissionStatus());
        setTimeout(() => syncDownloads(cachedTracks).catch(() => {}), 0);

        // 🚀 Punto 3.1: Encendido automático y silencioso del Worker en segundo plano tras 5 segundos
        syncTimer = setTimeout(async () => {
          const { canSync } = await checkCanSync();
          if (canSync) {
            await startBackgroundSync({ batchSize: 15 });
          }
        }, 5000);
      } catch (err) {
        console.error('Error al inicializar la arquitectura de Milla:', err);
        setIsDbReady(true);
        setHasPermissions(false);
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
    const downloadableTracks = sourceTracks.filter((track) => String(track.url || '').startsWith('http'));
    const localResults = await Promise.all(
      downloadableTracks.map(async (track) => ({ id: track.id, uri: await getLocalTrackUri(track.id) }))
    );
    localResults.forEach(({ id, uri }) => {
      if (uri) downloaded.add(id);
    });
    setDownloadedIds(downloaded);
    const sizeStr = await getDownloadsFolderSize();
    setCacheSize(sizeStr);
  };

  // 2. Sincronizar track activo de TrackPlayer con la UI y la Cola Inteligente
  useEffect(() => {
    if (activeTrack) {
      const activeId = String(activeTrack.id);
      const foundInCatalog = tracksById.get(activeId) || tracksList.find((t) => activeId.endsWith(`${t.id}.flac`));

      const updatedTrack: Track = {
        ...(foundInCatalog || ({} as Track)),
        id: activeId,
        url: foundInCatalog?.url || String(activeTrack.url || ''),
        title: activeTrack.title || foundInCatalog?.title || 'Unknown Track',
        artist: activeTrack.artist || foundInCatalog?.artist || 'Unknown Artist',
        album: activeTrack.album || foundInCatalog?.album || 'Unknown Album',
        duration: activeTrack.duration || foundInCatalog?.duration,
        artwork: foundInCatalog?.artwork_thumb || activeTrack.artwork || foundInCatalog?.artwork,
        artwork_thumb: foundInCatalog?.artwork_thumb,
        qualityBadge: foundInCatalog?.qualityBadge || (activeId.startsWith('file:') || String(activeTrack.url || '').startsWith('file:') ? 'Local Audio' : 'Hi-Res Lossless'),
      };

      setCurrentTrack(updatedTrack);
      setQueueCurrentTrack(updatedTrack as VertexTrack);
    }
  }, [activeTrack, tracksById, tracksList]);

  useEffect(() => {
    let cancelled = false;
    if (!currentTrack?.id) {
      setIsLiked(false);
      return;
    }
    isTrackFavorite(currentTrack.id)
      .then((liked) => {
        if (!cancelled) setIsLiked(liked);
      })
      .catch(() => {
        if (!cancelled) setIsLiked(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentTrack?.id]);

  const handleToggleLike = useCallback(async () => {
    if (!currentTrack?.id) return;
    const previous = isLiked;
    setIsLiked(!previous);
    try {
      setIsLiked(await toggleTrackFavorite(currentTrack.id));
    } catch (error) {
      setIsLiked(previous);
      Alert.alert('Me encanta', 'No se pudo actualizar la playlist de favoritos.');
    }
  }, [currentTrack?.id, isLiked]);

  const openCurrentArtist = useCallback(() => {
    if (!currentTrack?.artist) return;
    const artistName = currentTrack.artist.trim();
    const artistTracks = tracksList.filter(
      (track) => String(track.artist || '').trim().toLocaleLowerCase('es') === artistName.toLocaleLowerCase('es')
    );
    setIsNowPlayingOpen(false);
    setCollectionTarget({
      kind: 'artist',
      title: artistName,
      artwork: currentTrack.artwork_thumb || currentTrack.artwork || artistTracks[0]?.artwork_thumb || artistTracks[0]?.artwork,
      tracks: artistTracks.length ? artistTracks : [currentTrack],
    });
  }, [currentTrack, tracksList]);

  const openCurrentAlbum = useCallback(() => {
    if (!currentTrack?.album) return;
    const albumName = currentTrack.album.trim();
    const artistName = currentTrack.artist || '';
    const albumTracks = tracksList.filter((track) =>
      String(track.album || '').trim().toLocaleLowerCase('es') === albumName.toLocaleLowerCase('es') &&
      String(track.artist || '').trim().toLocaleLowerCase('es') === artistName.trim().toLocaleLowerCase('es')
    );
    setIsNowPlayingOpen(false);
    setCollectionTarget({
      kind: 'album',
      title: albumName,
      subtitle: artistName,
      artwork: currentTrack.artwork_thumb || currentTrack.artwork || albumTracks[0]?.artwork_thumb || albumTracks[0]?.artwork,
      tracks: albumTracks.length ? albumTracks : [currentTrack],
    });
  }, [currentTrack, tracksList]);

  const handleSelectTab = (nextTab: string) => {
    if (nextTab === activeTab) return;
    const history = tabHistoryRef.current;
    if (history[history.length - 1] !== nextTab) history.push(nextTab);
    setActiveTab(nextTab);
  };

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (collectionTarget) {
        setCollectionTarget(null);
        return true;
      }
      if (isNowPlayingOpen) {
        setIsNowPlayingOpen(false);
        return true;
      }
      if (isSidebarOpen) {
        setIsSidebarOpen(false);
        return true;
      }
      const history = tabHistoryRef.current;
      if (history.length > 1) {
        history.pop();
        setActiveTab(history[history.length - 1] || 'home');
        return true;
      }
      // Milla conserva la sesion de reproduccion: el boton del sistema nunca
      // cierra la app desde la pestaña raiz de forma accidental.
      return true;
    });
    return () => subscription.remove();
  }, [activeTab, collectionTarget, isNowPlayingOpen, isSidebarOpen]);

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
  const handleSelectTrack = useCallback(async (track: Track) => {
    try {
      queueManager.setSessionAutoMixForced(isSmartDJActive);
      const index = tracksList.findIndex((item) => item.id === track.id);
      const localUri = String(track.url || '').startsWith('http') ? await getLocalTrackUri(track.id) : null;
      const sourceTracks = localUri
        ? tracksList.map((item) => item.id === track.id ? { ...item, url: localUri } : item)
        : tracksList;
      const selectedTrack = sourceTracks[index >= 0 ? index : 0] || track;
      await playPlaylist(sourceTracks, index >= 0 ? index : 0);

      // Artwork, embedded lyrics and ID3 stay off the navigation path. They
      // are persisted after the audio has already started.
      void hydrateTrackMetadataForPlayback(selectedTrack)
        .then((hydrated) => {
          setTracksList((current) => current.map((item) => item.id === hydrated.id ? { ...item, ...hydrated } : item));
          setCurrentTrack((current) => current?.id === hydrated.id ? { ...current, ...hydrated } : current);
          setQueueCurrentTrack(hydrated as VertexTrack);
        })
        .catch((metadataError) => {
          console.warn('[App] No se pudieron hidratar los metadatos de la pista activa:', metadataError);
        });
    } catch (error: any) {
      console.error('No se pudo iniciar la pista seleccionada:', error);
      Alert.alert('No se pudo reproducir', error?.message || 'La ruta local de esta pista ya no es accesible. Vuelve a escanearla.');
    }
  }, [isSmartDJActive, queueManager, setQueueCurrentTrack, tracksList]);

  const handlePlayPause = async () => {
    if (Platform.OS === 'web') return;
    try {
      const state = typeof playbackState === 'object' && playbackState !== null ? playbackState.state : playbackState;
      if (state === State.Playing) {
        await TrackPlayer.pause();
      } else {
        await TrackPlayer.play();
      }
    } catch (error) {
      console.warn('[App] No se pudo cambiar el estado de reproduccion:', error);
    }
  };

  const handleNext = async () => {
    if (Platform.OS === 'web') return;
    try {
      // Consultar al Maestro (VertexQueueManager: Capa 1 Prioridad o Capa 2 AutoMix)
      const nextFromQueue = queueManager.getNextTrack();
      if (nextFromQueue) {
        const queue = await TrackPlayer.getQueue();
        const existingIndex = queue.findIndex((t) => t.id === nextFromQueue.id);
        if (existingIndex >= 0) {
          await TrackPlayer.skip(existingIndex);
        } else {
          const nextTrackUrl = await ensureTrackPlayableUri(nextFromQueue);
          if (!isTrackPlayerCompatibleUri(nextTrackUrl)) {
            throw new Error('La siguiente pista no tiene una ruta local reproducible.');
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
    }
  };

  const handlePrev = async () => {
    if (Platform.OS === 'web') return;
    try {
      await TrackPlayer.skipToPrevious();
    } catch (e) {
    }
  };

  // Activar / Desactivar Radio Inteligente MillaSmartDJ
  const handleToggleSmartDJ = async () => {
    const nextState = !isSmartDJActive;
    try {
      const settings = await getAutoMixSettings();
      await saveAutoMixSettings({ ...settings, enabled: nextState });
      await queueManager.syncSettings();
      await configureAutoMixQueue(tracksList, currentTrack, nextState);
    } catch (error) {
      console.error('No se pudo reconfigurar Auto Mix:', error);
      Alert.alert('Auto Mix', 'No se pudo reconfigurar la cola actual. Intenta de nuevo al cambiar de pista.');
      return;
    }
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

  // Descarga de pistas para almacenamiento sin conexión
  const runFullLibraryOptimization = async () => {
    setIsOptimizing(true);
    setOptimizationProgressText('Preparando analisis de la biblioteca...');
    try {
      const updatedTracks = [...tracksList];
      const repairedTracks: Track[] = [];
      const metadataCandidates = updatedTracks.filter((track) => {
        const artist = String(track.artist || '').toLowerCase();
        const title = String(track.title || '').toLowerCase();
        return Boolean(track.needs_repair) || artist.includes('unknown') || title.includes('unknown');
      });

      for (let index = 0; index < metadataCandidates.length; index++) {
        const track = metadataCandidates[index];
        setOptimizationProgressText(
          `Metadatos ${index + 1}/${metadataCandidates.length}: ${track.title}`
        );
        const query = `${track.artist && track.artist !== 'Unknown' ? `${track.artist} - ` : ''}${track.title}`;
        const match = await searchRecording(query).catch(() => null);
        if (match && match.score > 70) {
          const fixedTrack: Track = {
            ...track,
            title: match.title || track.title,
            artist: match.artist || track.artist,
            album: match.album || track.album,
            needs_repair: false,
          };
          const originalIndex = updatedTracks.findIndex((item) => item.id === track.id);
          if (originalIndex >= 0) updatedTracks[originalIndex] = fixedTrack;
          repairedTracks.push(fixedTrack);
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 16));
      }
      if (repairedTracks.length > 0) await insertTracks(repairedTracks);

      const dspResult = await analyzeLibraryAudio(updatedTracks, {
        onProgress: ({ current, total, title, phase }) => {
          if (phase === 'preparing' || phase === 'saved' || phase === 'failed') {
            setOptimizationProgressText(`Audio ${current}/${total}: ${title}`);
          }
        },
      });

      const refreshedTracks = await getCachedTracks();
      setTracksList(refreshedTracks);
      setCatalog(refreshedTracks as VertexTrack[]);

      if (!dspResult.success && dspResult.reason) {
        Alert.alert(
          'AutoMix DSP',
          `Se repararon ${repairedTracks.length} metadatos, pero el analisis de audio no pudo iniciar: ${dspResult.reason}.`
        );
      } else {
        Alert.alert(
          'Biblioteca optimizada',
          `${repairedTracks.length} metadatos reparados, ${dspResult.syncedCount} pistas analizadas y ${dspResult.failedCount} pendientes.`
        );
      }
    } catch (error) {
      console.error('[App] Error en el optimizador de biblioteca:', error);
      Alert.alert('Error de optimizacion', 'No se pudo completar el analisis de la biblioteca.');
    } finally {
      setIsOptimizing(false);
      setOptimizationProgressText('');
    }
  };

  const handleOptimizeLibrary = () => {
    if (isOptimizing) return;
    const pendingAudio = tracksList.filter((track) =>
      track.analysis_status !== 'ready' || !track.bpm || !track.camelot_key || !track.outro_duration_ms
    ).length;
    const pendingMetadata = tracksList.filter((track) => {
      const artist = String(track.artist || '').toLowerCase();
      const title = String(track.title || '').toLowerCase();
      return Boolean(track.needs_repair) || artist.includes('unknown') || title.includes('unknown');
    }).length;

    if (pendingAudio === 0 && pendingMetadata === 0) {
      Alert.alert('Milla AutoMix', 'La biblioteca ya tiene metadatos y analisis acustico completos.');
      return;
    }

    Alert.alert(
      'Analizar biblioteca para AutoMix',
      `Se procesaran ${pendingAudio} archivos de audio uno por uno. Manten la app en primer plano y usa Wi-Fi; puedes continuar escuchando musica durante el proceso.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Iniciar', onPress: () => void runFullLibraryOptimization() },
      ]
    );
  };

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
      Alert.alert('Interfaz de reproduccion', `La frecuencia de actualizacion visual se ajusto a ${mode.toUpperCase()}. La calidad del archivo original no se modifica.`);
    } catch (err) {
      console.error('Error updating buffer mode:', err);
    }
  };

  const isLightTheme = currentTheme === 'theme-latte' || currentTheme === 'theme-white';

  if (!isDbReady || hasPermissions === null) {
    return (
      <View className={`${currentTheme} flex-1 justify-center items-center`} style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]}>
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
      <View className={`${currentTheme} flex-1 justify-center items-center px-8`} style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]}>
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
              if (isRequestingPermission) return;
              setIsRequestingPermission(true);
              try {
                const granted = await requestLibraryPermission();
                if (granted) {
                  setHasPermissions(true);
                } else {
                Alert.alert('Permiso denegado', 'Por favor, otorga el permiso de archivos para que Milla pueda escanear tu música local.');
                }
              } finally {
                setIsRequestingPermission(false);
              }
            }}
            disabled={isRequestingPermission}
            className="bg-blue-600 w-full py-4 rounded-2xl items-center shadow-lg"
          >
            <Text className="text-white font-bold text-base tracking-wide">
              {isRequestingPermission ? 'Abriendo permisos...' : 'Conceder Acceso'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View className={`${currentTheme} flex-1`} style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]}>
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
            onClearCache={handleClearCache}
            cacheSize={cacheSize}
            onAutoMixEnabledChange={(enabled) => {
              setIsSmartDJActive(enabled);
              void configureAutoMixQueue(tracksList, currentTrack, enabled).catch((error) => {
                console.warn('No se pudo aplicar AutoMix a la cola activa:', error);
              });
            }}
            onLibraryChanged={async () => {
              const refreshed = await getCachedTracks();
              setTracksList(refreshed);
              setCatalog(refreshed as VertexTrack[]);
            }}
          />
        ) : activeTab === 'playlists' ? (
          <PlaylistsScreen
            onOpenSidebar={() => setIsSidebarOpen(true)}
            currentTrackId={currentTrack?.id}
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
            optimizationProgressText={optimizationProgressText}
            onNavigateToArtists={() => handleSelectTab('artistas')}
            onAutoMixSessionChange={setIsSmartDJActive}
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
          onToggleLike={() => void handleToggleLike()}
          onPressBar={() => setIsNowPlayingOpen(true)}
          onOpenLyrics={() => {
            setIsNowPlayingOpen(true);
            setLyricsRequestNonce((value) => value + 1);
          }}
          onOpenQueue={() => {
            setIsNowPlayingOpen(true);
            setQueueRequestNonce((value) => value + 1);
          }}
          onAddToPlaylist={() => setPlaylistPickerTrack(currentTrack)}
          onSleepTimer={() => {
            setIsNowPlayingOpen(true);
            setSleepTimerRequestNonce((value) => value + 1);
          }}
          onCast={() => Alert.alert('Transmitir', 'No se encontro un dispositivo de audio disponible en la red.')}
        />
        )}
      </View>

      {/* Menú Lateral */}
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
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
        onToggleLike={() => void handleToggleLike()}
        onToggleSmartDJ={handleToggleSmartDJ}
        isSmartDJActive={isSmartDJActive}
        lyricsRequestNonce={lyricsRequestNonce}
        queueRequestNonce={queueRequestNonce}
        sleepTimerRequestNonce={sleepTimerRequestNonce}
        onOpenArtist={openCurrentArtist}
        onOpenAlbum={openCurrentAlbum}
      />
      <PlaylistPickerModal
        visible={Boolean(playlistPickerTrack)}
        track={playlistPickerTrack}
        onClose={() => setPlaylistPickerTrack(null)}
        onAdded={(playlist) => {
          const title = playlistPickerTrack?.title || 'La cancion';
          setPlaylistPickerTrack(null);
          Alert.alert('Playlist', `"${title}" se agrego a ${playlist.name}.`);
        }}
      />
      {collectionTarget ? (
        <View style={[StyleSheet.absoluteFill, { zIndex: 90 }]}>
          <CollectionDetailView
            kind={collectionTarget.kind}
            title={collectionTarget.title}
            subtitle={collectionTarget.subtitle}
            artwork={collectionTarget.artwork}
            tracks={collectionTarget.tracks}
            currentTrackId={currentTrack?.id}
            onBack={() => setCollectionTarget(null)}
          />
        </View>
      ) : null}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <VertexQueueProvider initialCatalog={[] as VertexTrack[]}>
        <ThemeProvider>
          <AppErrorBoundary>
            <MainAppContent />
          </AppErrorBoundary>
        </ThemeProvider>
      </VertexQueueProvider>
    </SafeAreaProvider>
  );
}
