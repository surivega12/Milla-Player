import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  Dimensions,
  ActivityIndicator,
  StyleSheet,
  Modal,
  Alert,
  Platform,
  BackHandler,
} from 'react-native';
import Animated, { useSharedValue, useAnimatedScrollHandler } from 'react-native-reanimated';
import { FlashList } from '@shopify/flash-list';
import { AnimatedHeader } from '../components/AnimatedHeader';
import {
  Search,
  Settings,
  Cast,
  Clock,
  FolderPlus,
  TrendingUp,
  Shuffle,
  RefreshCw,
  ArrowRight,
  ArrowLeft,
  Play,
  MoreVertical,
  Disc,
  User,
  FolderOpen,
  Sparkles,
  Zap,
  Heart,
  Radio,
  Smile,
  Coffee,
} from 'lucide-react-native';
import { Track } from '../components/PlayerBar';
import { NotificationCard } from '../components/NotificationCard';
import { useVertexQueue } from '../services/queue-service';
import { playPlaylist } from '../services/audio-service';
import { getTracksByGenre, getForgottenTracks, getTracksByEmotion } from '../services/database-service';
import { getThemeColors } from '../utils/theme-colors';

const { width } = Dimensions.get('window');

export const SAMPLE_CATALOG: Track[] = [];

interface HomeScreenProps {
  onOpenSidebar: () => void;
  onSelectTrack: (track: Track) => void;
  currentTrackId?: string;
  currentTheme: string;
  onSelectTheme: (theme: string) => void;
  tracks: Track[];
  onScanLocal: () => void;
  onScanManualFolder: () => void;
  isScanning: boolean;
  scanProgressText?: string;
  downloadedIds: Set<string>;
  downloadProgress: Record<string, number>;
  onDownloadTrack: (track: Track) => void;
  onOptimize?: () => void;
  isOptimizing?: boolean;
  optimizationProgressText?: string;
  onNavigateToArtists?: () => void;
}

type SubScreenType = 'home' | 'history' | 'recent' | 'top_played';

export const HomeScreen: React.FC<HomeScreenProps> = ({
  onOpenSidebar,
  onSelectTrack,
  currentTrackId,
  currentTheme,
  onSelectTheme,
  tracks,
  onScanLocal,
  onScanManualFolder,
  isScanning,
  scanProgressText,
  downloadedIds,
  downloadProgress,
  onDownloadTrack,
  onOptimize,
  isOptimizing = false,
  optimizationProgressText,
  onNavigateToArtists,
}) => {
  const colors = getThemeColors(currentTheme);
  const [activeSubScreen, setActiveSubScreen] = useState<SubScreenType>('home');
  const [isEmotionModalOpen, setIsEmotionModalOpen] = useState<boolean>(false);
  const { setCatalog, setSessionAutoMixForced } = useVertexQueue();

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (isEmotionModalOpen) {
        setIsEmotionModalOpen(false);
        return true;
      }
      if (activeSubScreen !== 'home') {
        setActiveSubScreen('home');
        return true;
      }
      return true;
    });
    return () => subscription.remove();
  }, [activeSubScreen, isEmotionModalOpen]);

  const startSessionPlaylist = async (playlistTracks: Track[], titleAlert: string) => {
    if (!playlistTracks || playlistTracks.length === 0) {
      Alert.alert('Milla DJ', 'No se encontraron suficientes pistas compatibles en la biblioteca local.');
      return;
    }
    if (typeof setSessionAutoMixForced === 'function') {
      setSessionAutoMixForced(true);
    }
    if (typeof setCatalog === 'function') {
      setCatalog(playlistTracks as any);
    }
    await playPlaylist(playlistTracks, 0);
    Alert.alert(
      titleAlert,
      `🎵 Sesión iniciada con ${playlistTracks.length} canciones.\n⚡ Modo Auto Mix con Crossfade FORZADO y activo para esta sesión táctica.`
    );
  };

  const scrollY = useSharedValue(0);
  const headerTranslationY = useSharedValue(0);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event, ctx: any) => {
      const currentY = event.contentOffset.y;
      const prevY = ctx.prevY ?? 0;
      const deltaY = currentY - prevY;
      
      let newTranslation = headerTranslationY.value - deltaY;
      if (newTranslation > 0) newTranslation = 0;
      if (newTranslation < -120) newTranslation = -120;
      
      if (currentY <= 0) newTranslation = 0;
      
      headerTranslationY.value = newTranslation;
      ctx.prevY = currentY;
      scrollY.value = currentY;
    },
    onBeginDrag: (event, ctx: any) => {
      ctx.prevY = event.contentOffset.y;
    }
  });

  const tracksNeedingRepair = tracks.filter((track) =>
    Boolean(track.needs_repair) ||
    track.analysis_status !== 'ready' ||
    !track.bpm ||
    !track.camelot_key ||
    !track.outro_duration_ms
  ).length;

  // Helpers de datos para las sub-pantallas
  const getSubScreenTitle = () => {
    if (activeSubScreen === 'history') return 'Historial';
    if (activeSubScreen === 'recent') return 'Añadidos recientemente';
    return 'Más reproducidas';
  };

  const getSubScreenTracks = () => {
    if (activeSubScreen === 'recent') return [...tracks].reverse();
    if (activeSubScreen === 'top_played') {
      return [...tracks].sort((a, b) => ((b as any).play_count || 0) - ((a as any).play_count || 0));
    }
    return tracks;
  };

  const getTrackQualityLabel = (track: Track): string => {
    if (track.qualityBadge) return track.qualityBadge;
    if (track.url && track.url.toLowerCase().endsWith('.flac')) return 'FLAC';
    if (track.url && track.url.toLowerCase().endsWith('.wav')) return 'WAV';
    return 'Hi-Res';
  };

  const topArtists = Array.from(
    new Set(tracks.map((track) => track.artist).filter((artist) => artist && artist !== 'Unknown Artist'))
  ).slice(0, 8);

  const topAlbums = Array.from(
    new Set(tracks.map((track) => track.album).filter((album): album is string => Boolean(album)))
  ).slice(0, 8);

  const getArtistArtwork = (artistName: string) => {
    const found = tracks.find((t) => t.artist === artistName && t.artwork);
    return found?.artwork;
  };

  const getAlbumArtwork = (albumTitle: string) => {
    const found = tracks.find((t) => (t.album === albumTitle || t.title === albumTitle) && t.artwork);
    return found?.artwork;
  };

  // Estilo de tarjeta Glassmorphism translúcido (Apple Music Glass)
  const glassCardStyle = {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  };

  const glassBannerStyle = {
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  };

  // -------------------------------------------------------------
  // VISTA SUB-PANTALLAS DE DETALLE (Historial, Recientes, Más reproducidas)
  // -------------------------------------------------------------
  if (activeSubScreen !== 'home') {
    const subTracks = getSubScreenTracks();

    return (
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} className="flex-1">
        {/* Cabecera Negra Sólida con Flecha de Retroceso y Estilo Apple Music */}
        <View className="flex-row items-center justify-between px-5 pt-14 pb-4 border-b" style={{ backgroundColor: colors.card, borderBottomColor: colors.border }}>
          <TouchableOpacity
            onPress={() => setActiveSubScreen('home')}
            hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
            className="p-1.5"
          >
            <ArrowLeft size={24} color={colors.foreground} />
          </TouchableOpacity>
          <Text className="text-xl font-extrabold" style={{ color: colors.foreground }}>{getSubScreenTitle()}</Text>
          <View className="w-9" />
        </View>

        {/* Dos Botones de Acción Rápida Minimalistas (Reproducir translúcido y Aleatorio en contraste) */}
        <View className="flex-row items-center gap-3.5 px-5 py-4 border-b" style={{ backgroundColor: colors.background, borderBottomColor: colors.border }}>
          {/* Botón Reproducir (Glassmorphism sutil) */}
          <TouchableOpacity
            onPress={() => {
              if (subTracks.length > 0) onSelectTrack(subTracks[0]);
              else onScanLocal();
            }}
            activeOpacity={0.8}
            className="flex-1 flex-row items-center justify-center py-3 px-6 rounded-full bg-white/10 border border-white/20 gap-2 shadow-sm"
          >
            <Play size={18} color="#FFFFFF" fill="#FFFFFF" />
            <Text className="text-white font-bold text-base tracking-tight">Reproducir</Text>
          </TouchableOpacity>

          {/* Botón Aleatorio (Sólido Blanco o Celeste brillante para invitar a la acción) */}
          <TouchableOpacity
            onPress={() => {
              if (subTracks.length > 0) {
                const randomIdx = Math.floor(Math.random() * subTracks.length);
                onSelectTrack(subTracks[randomIdx]);
              } else {
                onScanLocal();
              }
            }}
            activeOpacity={0.85}
            className="flex-1 flex-row items-center justify-center py-3 px-6 rounded-full bg-white gap-2 shadow-md"
          >
            <Shuffle size={18} color="#000000" />
            <Text className="text-black font-bold text-base tracking-tight">Aleatorio</Text>
          </TouchableOpacity>
        </View>

        {/* Lista Compacta de Canciones estilo Apple Music con Badges explícitos / Hi-Res */}
        <FlashList
          data={subTracks}
          keyExtractor={(track) => track.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 130, paddingHorizontal: 20, paddingTop: 8 }}
          style={{ backgroundColor: colors.background }}
          ListEmptyComponent={(
            <View className="items-center justify-center py-20 px-4">
              <Disc size={52} color="#3F3F46" />
              <Text className="text-white font-bold text-base mt-4 text-center">
                Ninguna pista disponible aquí
              </Text>
              <Text className="text-gray-400 text-xs mt-1 text-center leading-relaxed">
                Pulsa en escanear para añadir e indexar tu colección de audio de alta fidelidad.
              </Text>
            </View>
          )}
          renderItem={({ item: track }) => {
            const isCurrent = currentTrackId === track.id;
            const displayArtwork = track.artwork_thumb || track.artwork;
            const qualityLabel = getTrackQualityLabel(track);
            return (
              <TouchableOpacity
                onPress={() => onSelectTrack(track)}
                activeOpacity={0.8}
                className="flex-row items-center justify-between py-3.5 border-b border-white/10"
              >
                <View className="flex-row items-center flex-1 mr-3">
                  <View className="w-12 h-12 rounded-xl bg-neutral-900 border border-white/10 overflow-hidden mr-3.5 justify-center items-center shadow-sm">
                    {displayArtwork ? (
                      <Image source={{ uri: displayArtwork }} className="w-full h-full" resizeMode="cover" />
                    ) : (
                      <Disc size={24} color="#6B7280" />
                    )}
                  </View>
                  <View className="flex-1 justify-center">
                    <View className="flex-row items-center gap-1.5 pr-2">
                      <Text
                        className={`text-sm font-semibold tracking-tight truncate flex-1 ${
                          isCurrent ? 'text-sky-400 font-bold' : 'text-white'
                        }`}
                        numberOfLines={1}
                      >
                        {track.title}
                      </Text>
                      <View className="bg-neutral-800 border border-neutral-700/80 px-1.5 py-0.5 rounded flex-row items-center">
                        <Text className="text-[9px] font-bold text-gray-300 uppercase tracking-wider">
                          {qualityLabel}
                        </Text>
                      </View>
                    </View>
                    <Text className="text-xs font-medium text-gray-400 mt-0.5 truncate" numberOfLines={1}>
                      {track.artist} {track.album ? `• ${track.album}` : ''}
                    </Text>
                  </View>
                </View>
                <View className="w-9" />
              </TouchableOpacity>
            );
          }}
        />
      </View>
    );
  }

  // -------------------------------------------------------------
  // VISTA PRINCIPAL HOME ('home') - APPLE MUSIC GLASSMORPHISM FUSION
  // -------------------------------------------------------------
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} className="flex-1">
      
      {/* CABECERA FLOTANTE ANIMADA (AnimatedHeader) */}
      <AnimatedHeader 
        title="Inicio" 
        headerTranslationY={headerTranslationY} 
        onOpenSidebar={onOpenSidebar} 
      />

      {/* CONTENIDO PRINCIPAL CON SCROLL ANIMADO */}
      <Animated.ScrollView
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 130, paddingTop: 130 }}
        className="flex-1"
        style={{ backgroundColor: colors.background }}
      >
        {/* 1. GRID DE ACCESOS RÁPIDOS ESTILO CRISTAL (Glassmorphism 2x2 Grid) */}
        <View className="px-5 mb-8">
          <View className="flex-row flex-wrap justify-between gap-y-3.5">
            {/* 1. Historial */}
            <TouchableOpacity
              onPress={() => setActiveSubScreen('history')}
              activeOpacity={0.85}
              style={[glassCardStyle, { width: '48%' }]}
              className="rounded-3xl p-4 flex-row items-center gap-3.5 shadow-lg"
            >
              <View className="w-10 h-10 rounded-2xl bg-white/10 border border-white/10 items-center justify-center shadow-sm">
                <Clock size={20} color="#FFFFFF" />
              </View>
              <View className="flex-1 justify-center">
                <Text className="text-sm font-bold text-white tracking-tight leading-tight" numberOfLines={1}>
                  Historial
                </Text>
                <Text className="text-[11px] text-gray-400 font-medium mt-0.5" numberOfLines={1}>
                  Últimas pistas
                </Text>
              </View>
            </TouchableOpacity>

            {/* 2. Añadidos recientemente */}
            <TouchableOpacity
              onPress={() => setActiveSubScreen('recent')}
              activeOpacity={0.85}
              style={[glassCardStyle, { width: '48%' }]}
              className="rounded-3xl p-4 flex-row items-center gap-3.5 shadow-lg"
            >
              <View className="w-10 h-10 rounded-2xl bg-white/10 border border-white/10 items-center justify-center shadow-sm">
                <FolderPlus size={20} color="#FFFFFF" />
              </View>
              <View className="flex-1 justify-center">
                <Text className="text-sm font-bold text-white tracking-tight leading-tight" numberOfLines={1}>
                  Recientes
                </Text>
                <Text className="text-[11px] text-gray-400 font-medium mt-0.5" numberOfLines={1}>
                  Nuevas en DB
                </Text>
              </View>
            </TouchableOpacity>

            {/* 3. Más reproducidas */}
            <TouchableOpacity
              onPress={() => setActiveSubScreen('top_played')}
              activeOpacity={0.85}
              style={[glassCardStyle, { width: '48%' }]}
              className="rounded-3xl p-4 flex-row items-center gap-3.5 shadow-lg"
            >
              <View className="w-10 h-10 rounded-2xl bg-white/10 border border-white/10 items-center justify-center shadow-sm">
                <TrendingUp size={20} color="#FFFFFF" />
              </View>
              <View className="flex-1 justify-center">
                <Text className="text-sm font-bold text-white tracking-tight leading-tight" numberOfLines={1}>
                  Más oídas
                </Text>
                <Text className="text-[11px] text-gray-400 font-medium mt-0.5" numberOfLines={1}>
                  Top selecciones
                </Text>
              </View>
            </TouchableOpacity>

            {/* 4. Mezcla por Beats (Sesión de Mezcla Inteligente) */}
            <TouchableOpacity
              onPress={() => {
                if (tracks.length > 0) {
                  const randomIdx = Math.floor(Math.random() * tracks.length);
                  onSelectTrack(tracks[randomIdx]);
                } else {
                  onScanLocal();
                }
              }}
              activeOpacity={0.85}
              style={[glassCardStyle, { width: '48%' }]}
              className="rounded-3xl p-4 flex-row items-center gap-3.5 shadow-lg"
            >
              <View className="w-10 h-10 rounded-2xl bg-orange-500/20 border border-orange-500/30 items-center justify-center shadow-sm">
                <Zap size={20} color="#B43C12" />
              </View>
              <View className="flex-1 justify-center">
                <Text className="text-sm font-bold text-white tracking-tight leading-tight" numberOfLines={1}>
                  Mezcla por Beats
                </Text>
                <Text className="text-[11px] text-orange-400/90 font-medium mt-0.5" numberOfLines={1}>
                  Sesión DJ
                </Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>

        {/* 2. SECCIÓN "TOP SELECCIONES PARA TI" (Carousel de Sugerencias y Estaciones Apple Music) */}
        <View className="mb-8">
          <View className="flex-row items-center justify-between px-5 mb-3.5">
            <Text className="text-xl font-bold text-white tracking-tight">
              Top selecciones para ti
            </Text>
            <TouchableOpacity
              onPress={onScanLocal}
              disabled={isScanning}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              className="p-1"
            >
              {isScanning ? (
                <ActivityIndicator size="small" color="#38BDF8" />
              ) : (
                <RefreshCw size={18} color="#9CA3AF" />
              )}
            </TouchableOpacity>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 20, gap: 16 }}
          >
            {/* 1. Tarjeta Naranja: Creador de Mixtapes por Género Táctico */}
            <TouchableOpacity
              onPress={async () => {
                const currentOrLast = tracks.find(t => t.id === currentTrackId) || tracks[0];
                const genreOrArtist = currentOrLast?.genre || currentOrLast?.artist || 'Pop';
                const genreTracks = await getTracksByGenre(genreOrArtist);
                await startSessionPlaylist(
                  genreTracks,
                  `Mixtape Táctico: ${genreOrArtist}`
                );
              }}
              activeOpacity={0.88}
              style={glassBannerStyle}
              className="w-56 h-64 rounded-3xl overflow-hidden relative shadow-2xl border border-white/20 p-5 justify-between"
            >
              <View className="absolute top-0 left-0 right-0 bottom-0 bg-gradient-to-tr from-orange-600 via-rose-500 to-amber-400 opacity-90" />

              <View className="flex-row items-center justify-between z-10">
                <View className="flex-row items-center gap-1.5 bg-black/30 px-2.5 py-1 rounded-full border border-white/20">
                  <Radio size={12} color="#FFFFFF" />
                  <Text className="text-[10px] font-bold text-white uppercase tracking-wider">
                    Mixtape Táctico
                  </Text>
                </View>
                <Text className="text-xs font-bold text-white/90 tracking-tight">
                  AutoMix ON
                </Text>
              </View>

              <View className="items-center justify-center my-auto z-10">
                <View className="w-16 h-16 rounded-full bg-white/20 border border-white/40 items-center justify-center shadow-lg">
                  <Disc size={28} color="#FFFFFF" />
                </View>
              </View>

              <View className="z-10">
                <Text className="text-xs font-semibold text-white/80 tracking-wide uppercase mb-0.5">
                  Por Género
                </Text>
                <Text className="text-xl font-black text-white tracking-tight leading-tight">
                  Mixtape de Género
                </Text>
              </View>
            </TouchableOpacity>

            {/* 2. Tarjeta Azul: Cápsula del Tiempo (Rescate de Olvidadas) */}
            <TouchableOpacity
              onPress={async () => {
                const forgottenTracks = await getForgottenTracks();
                await startSessionPlaylist(
                  forgottenTracks,
                  'Cápsula del Tiempo'
                );
              }}
              activeOpacity={0.88}
              style={glassBannerStyle}
              className="w-56 h-64 rounded-3xl overflow-hidden relative shadow-2xl border border-white/20 p-5 justify-between"
            >
              <View className="absolute top-0 left-0 right-0 bottom-0 bg-gradient-to-tr from-blue-600 via-indigo-600 to-purple-500 opacity-90" />

              <View className="flex-row items-center justify-between z-10">
                <View className="flex-row items-center gap-1.5 bg-black/30 px-2.5 py-1 rounded-full border border-white/20">
                  <Zap size={12} color="#FFFFFF" />
                  <Text className="text-[10px] font-bold text-white uppercase tracking-wider">
                    Rescate
                  </Text>
                </View>
                <Text className="text-xs font-bold text-white/90 tracking-tight">
                  AutoMix ON
                </Text>
              </View>

              <View className="items-center justify-center my-auto z-10">
                <View className="w-16 h-16 rounded-full bg-white/20 border border-white/40 items-center justify-center shadow-lg">
                  <RefreshCw size={28} color="#FFFFFF" />
                </View>
              </View>

              <View className="z-10">
                <Text className="text-xs font-semibold text-white/80 tracking-wide uppercase mb-0.5">
                  Cero reproducciones
                </Text>
                <Text className="text-xl font-black text-white tracking-tight leading-tight">
                  Cápsula del Tiempo
                </Text>
              </View>
            </TouchableOpacity>

            {/* 3. Tarjeta Gris/Cristalina Fija: Rueda de Emociones (Vibra y Estado de Ánimo) */}
            <TouchableOpacity
              onPress={() => setIsEmotionModalOpen(true)}
              activeOpacity={0.88}
              style={glassBannerStyle}
              className="w-56 h-64 rounded-3xl overflow-hidden relative shadow-2xl border border-white/15 p-5 justify-between bg-neutral-900/80"
            >
              <View className="absolute top-0 left-0 right-0 bottom-0 bg-white/[0.03]" />

              <View className="flex-row items-center justify-between z-10">
                <View className="flex-row items-center gap-1.5 bg-black/40 px-2.5 py-1 rounded-full border border-white/10">
                  <Sparkles size={12} color="#B43C12" />
                  <Text className="text-[10px] font-bold text-white uppercase tracking-wider">
                    Estación IA
                  </Text>
                </View>
                <Text className="text-xs font-bold text-gray-400 tracking-tight">
                  Deezer Style
                </Text>
              </View>

              <View className="items-center justify-center my-auto z-10">
                <View className="w-16 h-16 rounded-full bg-white/10 border border-white/20 items-center justify-center shadow-lg">
                  <Heart size={28} color="#B43C12" />
                </View>
              </View>

              <View className="z-10">
                <Text className="text-xs font-semibold text-gray-400 tracking-wide uppercase mb-0.5">
                  Selector de Estado
                </Text>
                <Text className="text-xl font-black text-white tracking-tight leading-tight">
                  Vibra y Ánimo
                </Text>
              </View>
            </TouchableOpacity>
          </ScrollView>
        </View>

        {/* 3. SECCIÓN "REPRODUCCIONES RECIENTES >" */}
        <View className="mb-8">
          <TouchableOpacity
            onPress={() => setActiveSubScreen('history')}
            activeOpacity={0.8}
            className="flex-row items-center justify-between px-5 mb-3.5"
          >
            <Text className="text-xl font-bold text-white tracking-tight">
              Reproducciones recientes
            </Text>
            <ArrowRight size={20} color="#9CA3AF" />
          </TouchableOpacity>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 20, gap: 16 }}
          >
            {tracks.length > 0
              ? tracks.slice(0, 6).map((track) => {
                  const displayArtwork = (track as any).artwork_thumb || track.artwork;
                  const qualityLabel = getTrackQualityLabel(track);

                  return (
                    <TouchableOpacity
                      key={`recent-${track.id}`}
                      onPress={() => onSelectTrack(track)}
                      activeOpacity={0.85}
                      className="w-36"
                    >
                      <View className="w-36 h-36 rounded-2xl bg-neutral-900 border border-white/10 overflow-hidden relative shadow-lg items-center justify-center mb-2">
                        {displayArtwork ? (
                          <Image source={{ uri: displayArtwork }} className="w-full h-full" resizeMode="cover" />
                        ) : (
                          <Disc size={36} color="#6B7280" />
                        )}
                      </View>

                      <View className="flex-row items-center gap-1.5 w-full">
                        <Text className="text-sm font-semibold text-white tracking-tight truncate flex-1" numberOfLines={1}>
                          {track.title}
                        </Text>
                        <View className="bg-neutral-800 border border-neutral-700 px-1 py-0.5 rounded">
                          <Text className="text-[9px] font-bold text-gray-300 uppercase">
                            {qualityLabel}
                          </Text>
                        </View>
                      </View>

                      <Text className="text-xs text-gray-400 font-medium mt-0.5 truncate w-full" numberOfLines={1}>
                        {track.artist}
                      </Text>
                    </TouchableOpacity>
                  );
                })
              : [1, 2, 3].map((_, idx) => (
                  <View key={`recent-ph-${idx}`} className="w-36">
                    <View className="w-36 h-36 rounded-2xl bg-neutral-900/60 border border-white/10 justify-center items-center p-3 mb-2">
                      <Disc size={32} color="#4B5563" />
                    </View>
                    <Text className="text-xs text-gray-500 font-medium truncate">Sin recientes</Text>
                  </View>
                ))}
          </ScrollView>
        </View>

        {/* 4. SECCIÓN "ENCUENTRA TU ESTADO DE ÁNIMO" */}
        <View className="mb-8">
          <View className="flex-row items-center justify-between px-5 mb-3.5">
            <Text className="text-xl font-bold text-white tracking-tight">
              Encuentra tu estado de ánimo
            </Text>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 20, gap: 14 }}
          >
            {/* Energy */}
            <TouchableOpacity
              onPress={() => {
                if (tracks.length > 0) onSelectTrack(tracks[0]);
                else onScanLocal();
              }}
              activeOpacity={0.88}
              className="w-36 h-36 rounded-2xl overflow-hidden p-4 justify-between border border-white/15 bg-emerald-600/80 shadow-lg"
            >
              <Text className="text-[10px] font-bold text-white/90 uppercase self-end tracking-wider">
                Milla Mood
              </Text>
              <Zap size={44} color="#FFFFFF" strokeWidth={1.2} className="self-center my-auto" />
              <Text className="text-sm font-bold text-white tracking-tight">Energy</Text>
            </TouchableOpacity>

            {/* Feeling Blue */}
            <TouchableOpacity
              onPress={() => {
                if (tracks.length > 0) onSelectTrack(tracks[0]);
                else onScanLocal();
              }}
              activeOpacity={0.88}
              className="w-36 h-36 rounded-2xl overflow-hidden p-4 justify-between border border-white/15 bg-blue-600/80 shadow-lg"
            >
              <Text className="text-[10px] font-bold text-white/90 uppercase self-end tracking-wider">
                Milla Mood
              </Text>
              <Disc size={44} color="#FFFFFF" strokeWidth={1.2} className="self-center my-auto" />
              <Text className="text-sm font-bold text-white tracking-tight">Feeling Blue</Text>
            </TouchableOpacity>

            {/* Relax */}
            <TouchableOpacity
              onPress={() => {
                if (tracks.length > 0) onSelectTrack(tracks[0]);
                else onScanLocal();
              }}
              activeOpacity={0.88}
              className="w-36 h-36 rounded-2xl overflow-hidden p-4 justify-between border border-white/15 bg-amber-600/80 shadow-lg"
            >
              <Text className="text-[10px] font-bold text-white/90 uppercase self-end tracking-wider">
                Milla Mood
              </Text>
              <Heart size={44} color="#FFFFFF" strokeWidth={1.2} className="self-center my-auto" />
              <Text className="text-sm font-bold text-white tracking-tight">Relax & Vibe</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>

        {/* 5. SECCIÓN "NOVEDADES" (New This Week & Recent Releases) */}
        <View className="mb-8">
          <View className="flex-row items-center justify-between px-5 mb-3.5">
            <Text className="text-xl font-bold text-white tracking-tight">Novedades</Text>
            <TouchableOpacity onPress={() => setActiveSubScreen('recent')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} className="p-1">
              <ArrowRight size={20} color="#9CA3AF" />
            </TouchableOpacity>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 20, gap: 16 }}
          >
            {tracks.length > 0
              ? [...tracks].reverse().slice(0, 8).map((track) => {
                  const displayArtwork = (track as any).artwork_thumb || track.artwork;
                  const qualityLabel = getTrackQualityLabel(track);

                  return (
                    <TouchableOpacity
                      key={`news-${track.id}`}
                      onPress={() => onSelectTrack(track)}
                      activeOpacity={0.85}
                      className="w-36"
                    >
                      <View className="w-36 h-36 rounded-2xl bg-neutral-900 border border-white/10 overflow-hidden relative shadow-lg items-center justify-center mb-2">
                        {displayArtwork ? (
                          <Image source={{ uri: displayArtwork }} className="w-full h-full" resizeMode="cover" />
                        ) : (
                          <Disc size={36} color="#6B7280" />
                        )}
                      </View>

                      <View className="flex-row items-center gap-1.5 w-full">
                        <Text className="text-sm font-semibold text-white tracking-tight truncate flex-1" numberOfLines={1}>
                          {track.title}
                        </Text>
                      </View>

                      <Text className="text-xs text-gray-400 font-medium mt-0.5 truncate w-full" numberOfLines={1}>
                        {(track.artist === 'Local Library' || track.artist === 'Unknown Artist') ? 'Unknown Artist' : track.artist}
                      </Text>
                    </TouchableOpacity>
                  );
                })
              : [1, 2, 3].map((_, idx) => (
                  <View key={`news-ph-${idx}`} className="w-36">
                    <View className="w-36 h-36 rounded-2xl bg-neutral-900/60 border border-white/10 justify-center items-center p-3 mb-2">
                      <Disc size={32} color="#4B5563" />
                    </View>
                    <Text className="text-xs text-gray-500 font-medium truncate">Sin novedades</Text>
                  </View>
                ))}
          </ScrollView>
        </View>

        {/* 6. SECCIÓN "TOP ARTISTS" */}
        <View className="mb-8">
          <View className="flex-row items-center justify-between px-5 mb-3.5">
            <Text className="text-xl font-bold text-white tracking-tight">Top artists</Text>
            <TouchableOpacity onPress={onNavigateToArtists} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} className="p-1">
              <ArrowRight size={20} color="#9CA3AF" />
            </TouchableOpacity>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 20, gap: 20 }}
          >
            {topArtists.map((artistName, idx) => {
              const artistImg = getArtistArtwork(artistName);
              return (
                <TouchableOpacity
                  key={`${artistName}-${idx}`}
                  onPress={() => {
                    const artistTrack = tracks.find((track) => track.artist === artistName);
                    if (artistTrack) onSelectTrack(artistTrack);
                  }}
                  className="items-center w-24 active:opacity-85"
                >
                  <View className="w-24 h-24 rounded-full bg-neutral-900 border border-white/15 overflow-hidden mb-2 justify-center items-center shadow-md">
                    {artistImg ? (
                      <Image source={{ uri: artistImg }} className="w-full h-full" resizeMode="cover" />
                    ) : (
                      <User size={36} color="#9CA3AF" />
                    )}
                  </View>
                  <Text className="text-xs font-semibold text-gray-300 text-center w-full" numberOfLines={1}>
                    {artistName}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Tarjeta de notificación y reparación si hay pistas pendientes */}
        <NotificationCard
          tracksNeedingRepair={tracksNeedingRepair}
          onOptimize={onOptimize}
          isOptimizing={isOptimizing}
          progressText={optimizationProgressText}
        />

        {/* Panel Inferior: Estado del Motor de Audio y Escaneo Rápido */}
        <View
          style={glassCardStyle}
          className="mx-5 mb-6 p-4 rounded-3xl flex-row items-center justify-between shadow-xl"
        >
          <View className="flex-1 mr-3">
            <Text className="text-xs font-bold text-white tracking-wide">
              {isScanning ? 'Sincronizando Biblioteca...' : 'Milla Native Audio Engine'}
            </Text>
            <Text className="text-[11px] text-gray-400 mt-0.5" numberOfLines={1}>
              {isScanning
                ? (scanProgressText || 'Escaneando archivos de audio compatibles...')
                : `${tracks.length} archivo(s) indexados en SQLite local`}
            </Text>
          </View>
          <View className="flex-row items-center gap-2">
            <TouchableOpacity
              onPress={onScanLocal}
              disabled={isScanning}
              className="px-3 py-2.5 rounded-2xl bg-sky-400/20 border border-sky-300/30 flex-row items-center gap-1.5"
            >
              {isScanning ? <ActivityIndicator size="small" color="#FFFFFF" /> : <RefreshCw size={15} color="#7DD3FC" />}
              <Text className="text-xs font-bold text-white">Todo</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onScanManualFolder}
              disabled={isScanning}
              className="px-3 py-2.5 rounded-2xl bg-white/10 border border-white/20 flex-row items-center gap-1.5"
            >
              <FolderOpen size={15} color="#38BDF8" />
              <Text className="text-xs font-bold text-white">Carpeta</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Animated.ScrollView>

      {/* Modal Traslúcido: Rueda de Emociones (Estilo Deezer / Apple Music) */}
      <Modal
        visible={isEmotionModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsEmotionModalOpen(false)}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setIsEmotionModalOpen(false)}
          className="flex-1 bg-black/80 justify-center items-center px-6"
        >
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => {}}
            className="w-full bg-neutral-900/95 rounded-3xl p-6 border border-white/15 shadow-2xl max-w-sm"
          >
            <View className="items-center mb-6">
              <View className="w-12 h-12 rounded-full bg-orange-600/20 border border-orange-500/30 items-center justify-center mb-3">
                <Sparkles size={24} color="#B43C12" />
              </View>
              <Text className="text-xl font-black text-white text-center">
                Rueda de Emociones
              </Text>
              <Text className="text-xs text-gray-400 text-center mt-1">
                Selecciona tu estado de ánimo o vibra actual para generar una mezcla instantánea con AutoMix forzado.
              </Text>
            </View>

            <View className="gap-3">
              <TouchableOpacity
                onPress={async () => {
                  setIsEmotionModalOpen(false);
                  const emotionTracks = await getTracksByEmotion('fiesta');
                  await startSessionPlaylist(emotionTracks, '🎉 Rueda de Emociones: Fiesta');
                }}
                className="flex-row items-center gap-3 bg-white/5 p-4 rounded-2xl border border-white/10 active:bg-white/10"
              >
                <Text className="text-2xl">🎉</Text>
                <View className="flex-1">
                  <Text className="text-base font-bold text-white">Fiesta</Text>
                  <Text className="text-xs text-gray-400">BPM altos, ritmos movidos y energía</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={async () => {
                  setIsEmotionModalOpen(false);
                  const emotionTracks = await getTracksByEmotion('triste');
                  await startSessionPlaylist(emotionTracks, '😭 Rueda de Emociones: Triste');
                }}
                className="flex-row items-center gap-3 bg-white/5 p-4 rounded-2xl border border-white/10 active:bg-white/10"
              >
                <Text className="text-2xl">😭</Text>
                <View className="flex-1">
                  <Text className="text-base font-bold text-white">Triste</Text>
                  <Text className="text-xs text-gray-400">BPM bajos, acústicos y baladas</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={async () => {
                  setIsEmotionModalOpen(false);
                  const emotionTracks = await getTracksByEmotion('alegre');
                  await startSessionPlaylist(emotionTracks, '😊 Rueda de Emociones: Alegre');
                }}
                className="flex-row items-center gap-3 bg-white/5 p-4 rounded-2xl border border-white/10 active:bg-white/10"
              >
                <Text className="text-2xl">😊</Text>
                <View className="flex-1">
                  <Text className="text-base font-bold text-white">Alegre</Text>
                  <Text className="text-xs text-gray-400">Tonalidades armónicas mayores y pop</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={async () => {
                  setIsEmotionModalOpen(false);
                  const emotionTracks = await getTracksByEmotion('enamorado');
                  await startSessionPlaylist(emotionTracks, '❤️ Rueda de Emociones: Enamorado');
                }}
                className="flex-row items-center gap-3 bg-white/5 p-4 rounded-2xl border border-white/10 active:bg-white/10"
              >
                <Text className="text-2xl">❤️</Text>
                <View className="flex-1">
                  <Text className="text-base font-bold text-white">Enamorado</Text>
                  <Text className="text-xs text-gray-400">Subgéneros melódicos y románticos</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={async () => {
                  setIsEmotionModalOpen(false);
                  const emotionTracks = await getTracksByEmotion('relax');
                  await startSessionPlaylist(emotionTracks, '☕ Rueda de Emociones: Relax');
                }}
                className="flex-row items-center gap-3 bg-white/5 p-4 rounded-2xl border border-white/10 active:bg-white/10"
              >
                <Text className="text-2xl">☕</Text>
                <View className="flex-1">
                  <Text className="text-base font-bold text-white">Relax</Text>
                  <Text className="text-xs text-gray-400">Música ambiental, downtempo o chill</Text>
                </View>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              onPress={() => setIsEmotionModalOpen(false)}
              className="mt-5 py-3 bg-white/10 rounded-xl items-center"
            >
              <Text className="text-sm font-semibold text-white">Cerrar</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};
