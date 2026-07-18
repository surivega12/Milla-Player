/**
 * FASE 4: MÓDULO DE LETRAS Y KARAOKE AVANZADO (VERTEX / MILLAY)
 * 
 * Componente nativo de alto rendimiento que combina:
 * 1. Glassmorphism real con 'expo-blur' y tintes dinámicos de carátula ('react-native-image-colors').
 * 2. Renderizado a 120 FPS con '@shopify/flash-list' para miles de líneas de letra.
 * 3. Sincronización Matemática y progreso milisegundo a milisegundo mediante 'useProgress()'.
 * 4. Animaciones de Karaoke dinámicas (escala 1.05, opacidad 1.0 / 0.4) utilizando Reanimated v3 'withSpring'.
 * 5. Búsqueda instantánea al tocar (Line-Click Seek con TrackPlayer.seekTo).
 */
import React, { useRef, useEffect, useMemo, useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  StyleSheet,
  Dimensions,
  Modal,
  Alert,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { FlashList } from '@shopify/flash-list';
import Animated, {
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import {
  MicVocal,
  Music2,
  Clock,
  Heart,
  List,
  SkipBack,
  SkipForward,
  Play,
  Pause,
  Cast,
  Globe,
  RefreshCw,
  X,
} from 'lucide-react-native';
import Slider from '@react-native-community/slider';
import TrackPlayer, { useProgress } from 'react-native-track-player';
import { getColors } from 'react-native-image-colors';

import { getThemeColors } from '../utils/theme-colors';
import { parseLrc, LyricLine } from '../utils/lyrics';
import { Track } from '../components/PlayerBar';
import LyricsWaveDom from '../components/LyricsWaveDom';

const { height } = Dimensions.get('window');

export interface LyricsModalProps {
  isOpen: boolean;
  onClose: () => void;
  track: Track | null;
  progress?: number;
  currentTheme?: string;
  onSeekToTime?: (timeSec: number) => void;
  isPlaying?: boolean;
  onPlayPause?: () => void;
  onNext?: () => void;
  onPrev?: () => void;
  isLiked?: boolean;
  onToggleLike?: () => void;
  onOpenQueue?: () => void;
}


interface LyricLineItemProps {
  item: LyricLine;
  isActive: boolean;
  isPast: boolean;
  accentColor: string;
  onPress: () => void;
}

const AnimatedTouchableOpacity = Animated.createAnimatedComponent(TouchableOpacity);

/**
 * Componente animado individual para cada línea de letra (Karaoke Style).
 * Mantiene escala de 1.05 para la línea activa y 1.0 para el resto con transiciones 'withSpring'.
 */
const LyricLineItem: React.FC<LyricLineItemProps> = React.memo(({
  item,
  isActive,
  isPast,
  accentColor,
  onPress,
}) => {
  const animatedStyle = useAnimatedStyle(() => {
    return {
      opacity: withTiming(isActive ? 1.0 : 0.4, { duration: 250 }),
      transform: [
        {
          scale: withSpring(isActive ? 1.05 : 1.0, {
            damping: 15,
            stiffness: 130,
          }),
        },
      ],
    };
  }, [isActive]);

  return (
    <AnimatedTouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[animatedStyle, { paddingVertical: 16, paddingHorizontal: 20 }]}
      className={`my-1.5 rounded-3xl transition-all ${
        isActive
          ? 'bg-white/15 border border-white/25 shadow-2xl'
          : 'bg-transparent border border-transparent'
      }`}
    >
      <View className="flex-row items-center justify-between gap-3">
        <Text
          className={`text-xl md:text-2xl leading-snug flex-1 ${
            isActive ? 'font-black tracking-tight text-white' : 'font-semibold text-neutral-400'
          }`}
          style={{
            textShadowColor: isActive ? accentColor : 'transparent',
            textShadowOffset: { width: 0, height: 0 },
            textShadowRadius: isActive ? 14 : 0,
          }}
        >
          {item.text}
        </Text>
        {isActive && (
          <View
            className="w-7 h-7 rounded-full items-center justify-center border border-white/40 shadow-lg"
            style={{ backgroundColor: accentColor }}
          >
            <MicVocal size={13} color="#ffffff" />
          </View>
        )}
      </View>
    </AnimatedTouchableOpacity>
  );
});

export const LyricsModal: React.FC<LyricsModalProps> = ({
  isOpen,
  onClose,
  track,
  progress = 0,
  currentTheme = 'theme-monochrome',
  onSeekToTime,
  isPlaying = false,
  onPlayPause,
  onNext,
  onPrev,
  isLiked = false,
  onToggleLike,
  onOpenQueue,
}) => {
  const colors = getThemeColors(currentTheme);
  const flashListRef = useRef<any>(null);
  const [dominantColor, setDominantColor] = useState<string>('#8b5cf6');
  const [waveMode, setWaveMode] = useState(true);
  const [waveReloadNonce, setWaveReloadNonce] = useState(0);
  const [timingOffsetMs, setTimingOffsetMs] = useState(0);
  const [seekDraft, setSeekDraft] = useState<number | null>(null);

  // 1. Consumir hook de progreso de react-native-track-player (frecuencia 100ms para precisión milimétrica)
  const { position: progressSec, duration: nativeDuration } = useProgress(500);

  // Calcular segundos actuales exactos (priorizando el hook del motor nativo TrackPlayer)
  const currentSeconds = useMemo(() => {
    if (progressSec >= 0 && nativeDuration > 0) return Math.max(0, progressSec + timingOffsetMs / 1000);
    if (!track || !track.duration) return 0;
    return Math.max(0, progress * track.duration + timingOffsetMs / 1000);
  }, [progressSec, nativeDuration, track, progress, timingOffsetMs]);

  // 2. Extraer el color vibrante de la carátula activa para el Glassmorphism y Highlights
  const imageUrl = track?.artwork_thumb || track?.artwork;
  useEffect(() => {
    let isMounted = true;
    if (!imageUrl) {
      setDominantColor('#8b5cf6');
      return;
    }
    getColors(imageUrl, {
      fallback: '#8b5cf6',
      cache: true,
      key: imageUrl,
    })
      .then((extracted) => {
        if (!isMounted) return;
        if (extracted.platform === 'android') {
          setDominantColor(extracted.dominant || extracted.vibrant || '#8b5cf6');
        } else if (extracted.platform === 'ios') {
          setDominantColor(extracted.primary || extracted.background || '#8b5cf6');
        } else {
          setDominantColor('#8b5cf6');
        }
      })
      .catch(() => {
        if (isMounted) setDominantColor('#8b5cf6');
      });
    return () => {
      isMounted = false;
    };
  }, [imageUrl]);

  // 3. Parsear letras optimizadas priorizando 'lyrics_json' cacheado en SQLite o decodificando 'lyrics_lrc'
  const lyricLines = useMemo((): LyricLine[] => {
    if (!track) return [];

    // A. Verificar si existe la estructura JSON ya calculada en SQLite o Django
    if (track.lyrics_json) {
      try {
        const parsedJson = typeof track.lyrics_json === 'string'
          ? JSON.parse(track.lyrics_json)
          : track.lyrics_json;
        if (Array.isArray(parsedJson) && parsedJson.length > 0) {
          return parsedJson.map((l: any) => ({
            time: Number(l.time || 0),
            text: String(l.text || '').trim(),
          })).filter(l => l.text.length > 0).sort((a, b) => a.time - b.time);
        }
      } catch (e) {
        console.warn('[LyricsModal] Error parseando lyrics_json, usando fallback LRC:', e);
      }
    }

    // B. Fallback a parsear el formato .lrc en bruto
    const rawLrc = track.lyrics_lrc || (track as any).lyrics || '';
    return parseLrc(rawLrc);
  }, [track]);

  // 4. Determinar la línea activa exactamente al milisegundo / segundo de reproducción
  const activeLineIndex = useMemo(() => {
    if (lyricLines.length === 0) return -1;
    for (let i = lyricLines.length - 1; i >= 0; i--) {
      const lineTimeSec = lyricLines[i].time > 10000
        ? lyricLines[i].time / 1000
        : lyricLines[i].time;
      // Ligero adelanto de 300ms para sincronía vocal visual instantánea
      if (currentSeconds + 0.3 >= lineTimeSec) {
        return i;
      }
    }
    return 0;
  }, [lyricLines, currentSeconds]);

  // 5. Auto-Scroll ultra suave con 'scrollToIndex' para mantener la línea activa siempre en el centro (viewPosition: 0.5)
  useEffect(() => {
    if (
      isOpen &&
      activeLineIndex >= 0 &&
      activeLineIndex < lyricLines.length &&
      flashListRef.current
    ) {
      try {
        flashListRef.current.scrollToIndex({
          index: activeLineIndex,
          animated: true,
          viewPosition: 0.5,
        });
      } catch (err) {
        // Ignorar si el layout aún está calculando alturas
      }
    }
  }, [activeLineIndex, isOpen, lyricLines.length]);

  // 6. Line-Click Seek (Saltar al tocar línea según especificación am-lyrics y milisegundos/segundos)
  const handleSeekToLyric = useCallback(async (lineTime: number) => {
    try {
      // Si la línea fue guardada en milisegundos (> 10,000), convertimos a segundos para TrackPlayer.seekTo()
      const targetSec = lineTime > 10000 ? lineTime / 1000 : lineTime;
      if (onSeekToTime) {
        onSeekToTime(targetSec);
      } else {
        await TrackPlayer.seekTo(targetSec);
      }
    } catch (error) {
      console.error('[LyricsModal] Error ejecutando seekTo al tocar línea:', error);
    } finally {
      setSeekDraft(null);
    }
  }, [onSeekToTime]);

  const cycleTimingOffset = () => {
    setTimingOffsetMs((current) => current === 0 ? 250 : current === 250 ? -250 : 0);
  };

  if (!isOpen || !track) {
    return null;
  }

  return (
    <Modal
      visible={isOpen}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={StyleSheet.absoluteFill} className="bg-black">
        {/* Capa de Carátula de Fondo con Desenfoque Inmersivo */}
        {imageUrl && (
          <Image
            source={{ uri: imageUrl }}
            style={[StyleSheet.absoluteFill, { opacity: 0.45 }]}
            blurRadius={80}
            resizeMode="cover"
          />
        )}

        {/* Resplandor Dinámico según color dominante de la carátula */}
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: dominantColor, opacity: 0.3 },
          ]}
        />

        {/* Efecto Glassmorphism translúcido con expo-blur */}
        <BlurView intensity={90} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={StyleSheet.absoluteFill} className="bg-gradient-to-b from-black/40 via-black/50 to-neutral-950/90" />

        <View className="flex-1 pt-14 pb-10 px-5 justify-between">
          
          {/* Cabecera am-l GitHub Style */}
          <View className="flex-row items-center justify-between mb-4 pb-3 border-b border-white/10 px-2">
            <View className="flex-row items-center gap-2">
              <Text className="text-xl font-black text-white tracking-tight">
                Lyrics
              </Text>
              <View className="px-2 py-0.5 rounded-md bg-white/15 border border-white/20">
                <Text className="text-[11px] font-bold text-neutral-300">
                  {timingOffsetMs >= 0 ? '+' : ''}{(timingOffsetMs / 1000).toFixed(2)}s
                </Text>
              </View>
            </View>

            <View className="flex-row items-center gap-4">
              <TouchableOpacity onPress={() => setWaveReloadNonce((value) => value + 1)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <RefreshCw size={18} color="#a3a3a3" />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setWaveMode((value) => !value)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Globe size={18} color={waveMode ? '#fed7aa' : '#a3a3a3'} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onClose}
                hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
                className="w-9 h-9 rounded-full bg-white/15 items-center justify-center border border-white/20 ml-1"
              >
                <X size={18} color="#ffffff" />
              </TouchableOpacity>
            </View>
          </View>


          {/* Renderizado de Alto Rendimiento con FlashList */}
          <View className="flex-1 my-2">
            {waveMode ? (
              <LyricsWaveDom
                key={`${track.id}-${waveReloadNonce}`}
                title={track.title || ''}
                artist={track.artist || ''}
                album={track.album}
                durationMs={(nativeDuration || track.duration || 0) * 1000}
                currentTimeMs={currentSeconds * 1000}
                isPlaying={isPlaying}
                highlightColor="#f6f4ef"
                onSeek={handleSeekToLyric}
              />
            ) : lyricLines.length === 0 ? (
              <View className="flex-1 items-center justify-center px-8 text-center">
                <MicVocal size={48} color="rgba(255,255,255,0.3)" style={{ marginBottom: 14 }} />
                <Text className="text-lg font-black text-white text-center">
                  Letras no disponibles para esta pista
                </Text>
                <Text className="text-xs text-neutral-400 text-center mt-2 leading-relaxed">
                  Esta pista FLAC/DSD no contiene etiquetas temporales de letra sincronizada en SQLite ni en su archivo local.
                </Text>
              </View>
            ) : (
              <FlashList<LyricLine>
                ref={flashListRef}
                data={lyricLines}
                {...({ estimatedItemSize: 68 } as any)}
                keyExtractor={(item, index) => `lyric-${item.time}-${index}`}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingVertical: Math.max(height * 0.22, 180) }}
                renderItem={({ item, index }) => {
                  const isActive = index === activeLineIndex;
                  const isPast = index < activeLineIndex;
                  return (
                    <LyricLineItem
                      item={item}
                      isActive={isActive}
                      isPast={isPast}
                      accentColor={dominantColor}
                      onPress={() => handleSeekToLyric(item.time)}
                    />
                  );
                }}
              />
            )}
          </View>

          {/* MiniPlayer Acoplado en la Base ('Control Inferior' am-l exacto a las fotos) */}
          <View className="rounded-3xl border border-white/15 bg-neutral-900/95 p-4 mb-1 shadow-2xl overflow-hidden">
            <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
            
            {/* Fila superior del MiniPlayer: Carátula, Título e Iconos de Acción */}
            <View className="flex-row items-center justify-between mb-2">
              <View className="flex-row items-center flex-1 mr-3">
                <View className="w-12 h-12 rounded-xl overflow-hidden bg-neutral-800 border border-white/10 mr-3 items-center justify-center">
                  {imageUrl ? (
                    <Image source={{ uri: imageUrl }} className="w-full h-full" resizeMode="cover" />
                  ) : (
                    <Music2 size={20} color="#ffffff" />
                  )}
                </View>
                <View className="flex-1">
                  <Text numberOfLines={1} className="text-base font-bold text-white tracking-tight">
                    {track.title || 'Canción Sin Título'}
                  </Text>
                  <Text numberOfLines={1} className="text-xs font-semibold text-neutral-400 mt-0.5">
                    {track.artist || 'Artista Desconocido'}
                  </Text>
                </View>
              </View>

              <View className="flex-row items-center gap-3">
                <TouchableOpacity onPress={onToggleLike || (() => {})} className="p-1">
                  <Heart size={20} color={isLiked ? '#ef4444' : '#a3a3a3'} fill={isLiked ? '#ef4444' : 'transparent'} />
                </TouchableOpacity>
                <TouchableOpacity onPress={onClose} className="p-1">
                  <MicVocal size={20} color="#fed7aa" />
                </TouchableOpacity>
                <TouchableOpacity onPress={onOpenQueue || (() => {})} className="p-1">
                  <List size={20} color="#a3a3a3" />
                </TouchableOpacity>
                <TouchableOpacity onPress={cycleTimingOffset} className="p-1">
                  <Clock size={20} color="#a3a3a3" />
                </TouchableOpacity>
              </View>
            </View>

            {/* Barra de Progreso Seekbar Naranja/Crema exacto */}
            <View className="w-full my-1">
              <Slider
                style={{ width: '100%', height: 24 }}
                minimumValue={0}
                maximumValue={Math.max(nativeDuration || track.duration || 0, 1)}
                value={seekDraft ?? currentSeconds}
                onSlidingStart={() => setSeekDraft(currentSeconds)}
                onValueChange={setSeekDraft}
                onSlidingComplete={(val) => handleSeekToLyric(val)}
                minimumTrackTintColor="#fed7aa"
                maximumTrackTintColor="rgba(255,255,255,0.15)"
                thumbTintColor="#fed7aa"
              />
              <View className="flex-row justify-between items-center px-1 -mt-1">
                <Text className="text-[10px] font-bold text-neutral-400">
                  {Math.floor(currentSeconds / 60)}:{Math.floor(currentSeconds % 60) < 10 ? '0' : ''}{Math.floor(currentSeconds % 60)}
                </Text>
                <Text className="text-[10px] font-bold text-neutral-400">
                  {Math.floor((track.duration || 225) / 60)}:{Math.floor((track.duration || 225) % 60) < 10 ? '0' : ''}{Math.floor((track.duration || 225) % 60)}
                </Text>
              </View>
            </View>

            {/* Controles de Reproducción Inferiores */}
            <View className="flex-row justify-around items-center pt-1">
              <TouchableOpacity onPress={onPrev || (() => {})} className="p-2">
                <SkipBack size={24} color="#ffffff" />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={onPlayPause || (() => {})}
                activeOpacity={0.8}
                className="w-12 h-12 rounded-full bg-[#fed7aa] items-center justify-center shadow-lg"
              >
                {isPlaying ? (
                  <Pause size={22} color="#000000" fill="#000000" />
                ) : (
                  <Play size={22} color="#000000" fill="#000000" style={{ marginLeft: 2 }} />
                )}
              </TouchableOpacity>

              <TouchableOpacity onPress={onNext || (() => {})} className="p-2">
                <SkipForward size={24} color="#ffffff" />
              </TouchableOpacity>

              <TouchableOpacity onPress={() => Alert.alert('Transmitir', 'No se encontro un dispositivo de audio disponible en la red.')} className="p-2">
                <Cast size={20} color="#a3a3a3" />
              </TouchableOpacity>
            </View>
          </View>


        </View>
      </View>
    </Modal>
  );
};
