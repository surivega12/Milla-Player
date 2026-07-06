import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  FlatList,
  ViewToken,
} from 'react-native';
import { BlurView } from 'expo-blur';
import Animated, { useAnimatedStyle, withTiming, useSharedValue } from 'react-native-reanimated';
import {
  ChevronDown,
  Sparkles,
  MicVocal,
  AudioLines,
  Heart,
  ListPlus,
  Download,
  Cast,
  List,
  Shuffle,
  SkipBack,
  Play,
  Pause,
  SkipForward,
  Repeat,
  Volume2,
  Radio,
} from 'lucide-react-native';
import TrackPlayer from 'react-native-track-player';
import { getThemeColors } from '../utils/theme-colors';
import { parseLrc, getDemoLyrics, LyricLine } from '../utils/lyrics';
import { Track } from './PlayerBar';

const { width } = Dimensions.get('window');
const ARTWORK_SIZE = Math.min(width * 0.72, 300);

interface NowPlayingModalProps {
  isOpen: boolean;
  onClose: () => void;
  track: Track | null;
  isPlaying: boolean;
  progress: number;
  currentTheme?: string;
  isLiked?: boolean;
  onPlayPause: () => void;
  onNext: () => void;
  onPrev: () => void;
  onToggleLike?: () => void;
}

// Componente animado para cada línea de la letra
const LyricLineRow = ({
  line,
  isActive,
  onPress,
  colors,
}: {
  line: LyricLine;
  isActive: boolean;
  onPress: () => void;
  colors: any;
}) => {
  const animatedStyle = useAnimatedStyle(() => {
    return {
      opacity: withTiming(isActive ? 1.0 : 0.35, { duration: 250 }),
      transform: [
        { scale: withTiming(isActive ? 1.06 : 0.95, { duration: 250 }) },
      ],
    };
  });

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} className="py-3 px-4 justify-center items-center">
      <Animated.Text
        style={[
          animatedStyle,
          { color: isActive ? colors.primary : colors.foreground },
        ]}
        className={`text-center tracking-wide font-black ${
          isActive ? 'text-xl' : 'text-base font-semibold'
        }`}
      >
        {line.text}
      </Animated.Text>
    </TouchableOpacity>
  );
};

export const NowPlayingModal: React.FC<NowPlayingModalProps> = ({
  isOpen,
  onClose,
  track,
  isPlaying,
  progress,
  currentTheme = 'theme-monochrome',
  isLiked = false,
  onPlayPause,
  onNext,
  onPrev,
  onToggleLike,
}) => {
  const colors = getThemeColors(currentTheme);
  const [showLyrics, setShowLyrics] = useState<boolean>(false);
  const flatListRef = useRef<FlatList<LyricLine>>(null);

  // Lógica de Doble Capa para el Crossfade Suave
  const [prevArtwork, setPrevArtwork] = useState<string | null>(null);
  const [currentArtwork, setCurrentArtwork] = useState<string | null>(track?.artwork || null);
  const crossfadeProgress = useSharedValue(1);

  useEffect(() => {
    if (track?.artwork !== currentArtwork) {
      setPrevArtwork(currentArtwork);
      setCurrentArtwork(track?.artwork || null);
      crossfadeProgress.value = 0;
      // Transición ultra suave de 800ms
      crossfadeProgress.value = withTiming(1, { duration: 800 });
    }
  }, [track?.artwork, currentArtwork]);

  const currentArtworkStyle = useAnimatedStyle(() => {
    return {
      opacity: crossfadeProgress.value,
      transform: [{ scale: 0.95 + 0.05 * crossfadeProgress.value }],
    };
  });

  const prevArtworkStyle = useAnimatedStyle(() => {
    return {
      opacity: 1 - crossfadeProgress.value,
      transform: [{ scale: 1 }],
      position: 'absolute',
      width: '100%',
      height: '100%',
      zIndex: -1,
    };
  });

  // Calcular duración y posición actual en segundos
  const totalSeconds = track?.duration || 225;
  const currentSeconds = Math.floor(totalSeconds * progress);

  // Obtener y decodificar letras para la pista actual
  const lyricLines = useMemo(() => {
    if (!track) return [];
    return parseLrc(getDemoLyrics(track.id));
  }, [track?.id]);

  // Identificar el índice de la línea de la letra activa
  const activeLineIndex = useMemo(() => {
    if (lyricLines.length === 0) return -1;
    let activeIndex = -1;
    for (let i = 0; i < lyricLines.length; i++) {
      if (currentSeconds >= lyricLines[i].time) {
        activeIndex = i;
      } else {
        break;
      }
    }
    return activeIndex;
  }, [lyricLines, currentSeconds]);

  // Hacer scroll automático a la línea activa de la letra
  useEffect(() => {
    if (showLyrics && activeLineIndex >= 0 && flatListRef.current) {
      flatListRef.current.scrollToIndex({
        index: activeLineIndex,
        animated: true,
        viewPosition: 0.35, // Centra el scroll un poco arriba del medio
      });
    }
  }, [activeLineIndex, showLyrics]);

  if (!isOpen || !track) {
    return null;
  }

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remSecs = secs % 60;
    return `${mins}:${remSecs < 10 ? '0' : ''}${remSecs}`;
  };

  const handleSeekToLyric = async (time: number) => {
    try {
      await TrackPlayer.seekTo(time);
    } catch (e) {
      console.error('Error seeking to lyric time:', e);
    }
  };

  return (
    <View style={StyleSheet.absoluteFill} className="z-50 bg-[var(--background)]">
      {/* Fondo esmerilado translúcido */}
      {track.artwork && (
        <Image
          source={{ uri: track.artwork }}
          style={[StyleSheet.absoluteFill, styles.bgImage]}
          blurRadius={50}
          resizeMode="cover"
        />
      )}
      <BlurView intensity={90} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, styles.dimOverlay]} />

      <View className="flex-1 pt-12 pb-8 px-6 justify-between">
        
        {/* Cabecera del Panel */}
        <View className="flex-row items-center justify-between mb-4">
          <TouchableOpacity
            onPress={onClose}
            hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
            className="w-10 h-10 rounded-full bg-[var(--secondary)]/50 items-center justify-center border border-[var(--border)]/30"
          >
            <ChevronDown size={22} color={colors.foreground} />
          </TouchableOpacity>

          <View className="items-center">
            <Text className="text-[10px] font-black tracking-widest text-[var(--muted-foreground)] uppercase">
              Playing from Library
            </Text>
            <View className="flex-row items-center px-2.5 py-0.5 mt-1 rounded-full bg-amber-500/15 border border-amber-500/40 gap-1">
              <Sparkles size={11} color="#f59e0b" />
              <Text className="text-[10px] font-black tracking-wider text-amber-400">
                {track.qualityBadge || 'FLAC 24-bit/192kHz'}
              </Text>
            </View>
          </View>

          <View className="flex-row items-center gap-2">
            {/* Botón para mostrar letras (Se activa con color de acento) */}
            <TouchableOpacity
              onPress={() => setShowLyrics(!showLyrics)}
              className={`w-10 h-10 rounded-full items-center justify-center ${
                showLyrics ? 'bg-[var(--primary)]' : 'bg-[var(--secondary)]/40'
              }`}
            >
              <MicVocal
                size={18}
                color={showLyrics ? colors.primaryForeground : colors.mutedForeground}
              />
            </TouchableOpacity>
            <TouchableOpacity className="w-10 h-10 rounded-full bg-[var(--secondary)]/40 items-center justify-center">
              <AudioLines size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Sección Central Dinámica: Carátula o Letras Sincronizadas */}
        <View className="flex-1 justify-center my-4 overflow-hidden">
          {!showLyrics ? (
            // Vista 1: Carátula Premium con efecto CD-Ring y metadatos
            <View className="flex-1 justify-around py-4">
              
              {/* CD-Ring de vinilo */}
              <View className="items-center justify-center relative my-4">
                <View style={{ width: ARTWORK_SIZE + 40, height: ARTWORK_SIZE }} className="items-center justify-center">
                  
                  {/* El disco óptico que se desliza por el lado derecho */}
                  <View
                    style={[
                      styles.cdRing,
                      {
                        width: ARTWORK_SIZE * 0.94,
                        height: ARTWORK_SIZE * 0.94,
                        borderRadius: (ARTWORK_SIZE * 0.94) / 2,
                        left: ARTWORK_SIZE * 0.26,
                      },
                    ]}
                  >
                    <View className="w-full h-full rounded-full border border-white/10 items-center justify-center bg-gradient-to-tr from-neutral-900 via-neutral-800 to-black shadow-inner">
                      <View className="w-20 h-20 rounded-full bg-black border-2 border-neutral-700/80 items-center justify-center shadow-lg">
                        <View className="w-7 h-7 rounded-full bg-[var(--background)] border border-neutral-600 shadow-inner" />
                      </View>
                    </View>
                  </View>

                  {/* Carátula en Primer Plano con Doble Capa */}
                  <View
                    style={{ width: ARTWORK_SIZE, height: ARTWORK_SIZE }}
                    className="rounded-2xl overflow-hidden shadow-2xl border border-[var(--border)]/80 bg-[var(--card)] z-10"
                  >
                    {prevArtwork && (
                      <Animated.Image
                        source={{ uri: prevArtwork }}
                        style={[prevArtworkStyle]}
                        resizeMode="cover"
                      />
                    )}
                    {currentArtwork ? (
                      <Animated.Image
                        source={{ uri: currentArtwork }}
                        style={[{ width: '100%', height: '100%' }, currentArtworkStyle]}
                        resizeMode="cover"
                      />
                    ) : (
                      <Animated.View style={[{ width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center', backgroundColor: 'var(--secondary)' }, currentArtworkStyle]}>
                        <Text className="text-xl font-bold text-[var(--muted-foreground)]">FLAC</Text>
                      </Animated.View>
                    )}
                  </View>

                </View>
              </View>

              {/* Título, Artista y Fila de Acciones Rápidas */}
              <View className="px-2 items-center">
                <Text
                  className="text-2xl font-black text-[var(--foreground)] text-center tracking-tight"
                  numberOfLines={2}
                >
                  {track.title}
                </Text>
                <Text
                  className="text-base font-semibold text-[var(--muted-foreground)] text-center mt-1"
                  numberOfLines={1}
                >
                  {track.artist}
                </Text>

                {/* Acciones Rápidas */}
                <View className="flex-row justify-center items-center gap-7 mt-6 w-full">
                  <TouchableOpacity onPress={onToggleLike} className="p-1">
                    <Heart
                      size={24}
                      color={isLiked ? '#ef4444' : colors.mutedForeground}
                      fill={isLiked ? '#ef4444' : 'transparent'}
                    />
                  </TouchableOpacity>
                  
                  {/* Botón MillaSmartDJ */}
                  <TouchableOpacity className="p-1">
                    <Radio size={22} color={colors.primary} />
                  </TouchableOpacity>
                  
                  <TouchableOpacity className="p-1">
                    <Download size={22} color={colors.mutedForeground} />
                  </TouchableOpacity>
                  <TouchableOpacity className="p-1">
                    <Cast size={22} color={colors.mutedForeground} />
                  </TouchableOpacity>
                  <TouchableOpacity className="p-1">
                    <List size={22} color={colors.mutedForeground} />
                  </TouchableOpacity>
                </View>
              </View>

            </View>
          ) : (
            // Vista 2: Letras Sincronizadas
            <View className="flex-1 w-full my-2">
              <FlatList
                ref={flatListRef}
                data={lyricLines}
                keyExtractor={(item, index) => `${item.time}-${index}`}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingVertical: 140 }}
                onScrollToIndexFailed={() => {}}
                renderItem={({ item, index }) => {
                  const isActive = index === activeLineIndex;
                  return (
                    <LyricLineRow
                      line={item}
                      isActive={isActive}
                      colors={colors}
                      onPress={() => handleSeekToLyric(item.time)}
                    />
                  );
                }}
              />
            </View>
          )}
        </View>

        {/* Sección Inferior Fija: Progreso y Controles de Reproducción */}
        <View className="w-full">
          {/* Barra de Progreso Seekbar */}
          <View className="w-full mb-4">
            <View className="h-1.5 w-full bg-[var(--secondary)]/80 rounded-full overflow-hidden mb-2 border border-[var(--border)]/30">
              <View
                className="h-full bg-[var(--primary)] rounded-full"
                style={{ width: `${Math.min(Math.max(progress * 100, 0), 100)}%` }}
              />
            </View>
            <View className="flex-row justify-between items-center px-1">
              <Text className="text-xs font-bold text-[var(--muted-foreground)]">
                {formatTime(currentSeconds)}
              </Text>
              <Text className="text-xs font-bold text-[var(--muted-foreground)]">
                {formatTime(totalSeconds)}
              </Text>
            </View>
          </View>

          {/* Controles Principales */}
          <View className="flex-row justify-between items-center px-4 mb-4">
            <TouchableOpacity className="p-2">
              <Shuffle size={22} color={colors.mutedForeground} />
            </TouchableOpacity>

            <TouchableOpacity onPress={onPrev} className="p-2">
              <SkipBack size={28} color={colors.foreground} />
            </TouchableOpacity>

            {/* Play / Pause Circular */}
            <TouchableOpacity
              onPress={onPlayPause}
              activeOpacity={0.85}
              className="w-16 h-16 rounded-full bg-[var(--primary)] justify-center items-center shadow-2xl"
            >
              {isPlaying ? (
                <Pause size={30} color={colors.primaryForeground} fill={colors.primaryForeground} />
              ) : (
                <Play
                  size={30}
                  color={colors.primaryForeground}
                  fill={colors.primaryForeground}
                  style={{ marginLeft: 3 }}
                />
              )}
            </TouchableOpacity>

            <TouchableOpacity onPress={onNext} className="p-2">
              <SkipForward size={28} color={colors.foreground} />
            </TouchableOpacity>

            <TouchableOpacity className="p-2">
              <Repeat size={22} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          {/* Slider de Volumen */}
          <View className="flex-row items-center gap-3 px-2">
            <Volume2 size={18} color={colors.mutedForeground} />
            <View className="flex-1 h-1 bg-[var(--secondary)]/80 rounded-full overflow-hidden">
              <View className="w-3/4 h-full bg-[var(--muted-foreground)] rounded-full" />
            </View>
          </View>
        </View>

      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  bgImage: {
    transform: [{ scale: 1.4 }],
    opacity: 0.55,
  },
  dimOverlay: {
    backgroundColor: 'rgba(10,10,10,0.55)',
  },
  cdRing: {
    position: 'absolute',
    backgroundColor: '#111111',
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 10, height: 10 },
    shadowOpacity: 0.8,
    shadowRadius: 15,
    elevation: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
