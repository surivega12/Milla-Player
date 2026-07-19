import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Alert,
  PanResponder,
} from 'react-native';
import { BlurView } from 'expo-blur';
import Animated, { runOnJS, useAnimatedStyle, withSpring, withTiming, useSharedValue } from 'react-native-reanimated';
import {
  ChevronDown,
  Sparkles,
  MicVocal,
  AudioLines,
  Download,
  Cast,
  List,
  ListMusic,
  Shuffle,
  SkipBack,
  Play,
  Pause,
  SkipForward,
  Repeat,
  Volume2,
  Radio,
  Clock,
  Timer,
  Moon,
  MoreVertical,
  Maximize,
} from 'lucide-react-native';
import Slider from '@react-native-community/slider';
import TrackPlayer, { RepeatMode, useProgress } from '../services/player-engine';
import { getThemeColors } from '../utils/theme-colors';
import { Track } from '../components/PlayerBar';
import { LyricsModal } from './LyricsModal';
import { QueueScreen } from './QueueScreen';
import { TrackOptionsModal } from '../components/TrackOptionsModal';
import { LiquidHeartButton } from '../components/LiquidHeartButton';


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
  onToggleSmartDJ?: () => void;
  isSmartDJActive?: boolean;
  lyricsRequestNonce?: number;
  queueRequestNonce?: number;
  sleepTimerRequestNonce?: number;
  onOpenArtist?: () => void;
  onOpenAlbum?: () => void;
}

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
  onToggleSmartDJ,
  isSmartDJActive = false,
  lyricsRequestNonce = 0,
  queueRequestNonce = 0,
  sleepTimerRequestNonce = 0,
  onOpenArtist,
  onOpenAlbum,
}) => {
  const colors = getThemeColors(currentTheme);
  const [showLyricsModal, setShowLyricsModal] = useState<boolean>(false);
  const [showQueueModal, setShowQueueModal] = useState<boolean>(false);
  const [showOptionsModal, setShowOptionsModal] = useState<boolean>(false);
  const [sleepTimerActive, setSleepTimerActive] = useState<boolean>(false);

  const [sleepRemainingSeconds, setSleepRemainingSeconds] = useState<number>(0);
  const [volume, setVolume] = useState<number>(0.85);
  const [volumeBarWidth, setVolumeBarWidth] = useState<number>(200);
  const [isShuffleActive, setIsShuffleActive] = useState<boolean>(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>(RepeatMode.Off);
  const [seekDraft, setSeekDraft] = useState<number | null>(null);
  const lastSleepRequestRef = useRef(0);
  const lastLyricsRequestRef = useRef(0);
  const lastQueueRequestRef = useRef(0);
  const nativeProgress = useProgress(500);
  const dismissY = useSharedValue(0);

  const dismissStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dismissY.value }],
    opacity: Math.max(0.72, 1 - dismissY.value / (Dimensions.get('window').height * 1.4)),
  }));

  const dismissPanResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) =>
      gesture.dy > 10 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.2,
    onMoveShouldSetPanResponderCapture: (_, gesture) =>
      gesture.dy > 10 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.2,
    onPanResponderMove: (_, gesture) => {
      dismissY.value = Math.max(0, gesture.dy);
    },
    onPanResponderRelease: (_, gesture) => {
      if (gesture.dy > 125 || gesture.vy > 0.85) {
        dismissY.value = withTiming(
          Dimensions.get('window').height,
          { duration: 220 },
          (finished) => {
            if (finished) runOnJS(onClose)();
          }
        );
      } else {
        dismissY.value = withSpring(0, { damping: 20, stiffness: 220 });
      }
    },
    onPanResponderTerminate: () => {
      dismissY.value = withSpring(0, { damping: 20, stiffness: 220 });
    },
  }), [dismissY, onClose]);

  useEffect(() => {
    if (isOpen) dismissY.value = 0;
  }, [isOpen, dismissY]);

  // Lógica de Doble Capa (Double-Layer Reanimated Crossfade)
  const [prevArtwork, setPrevArtwork] = useState<string | null>(null);
  const displayArtwork = track?.artwork_thumb || track?.artwork || null;
  const [currentArtwork, setCurrentArtwork] = useState<string | null>(displayArtwork);
  const [currentArtworkFailed, setCurrentArtworkFailed] = useState(false);
  const crossfadeProgress = useSharedValue(1);

  useEffect(() => {
    if (displayArtwork !== currentArtwork) {
      setPrevArtwork(currentArtwork);
      setCurrentArtwork(displayArtwork);
      setCurrentArtworkFailed(false);
      crossfadeProgress.value = 0;
      // Transición ultra fluida de 800ms
      crossfadeProgress.value = withTiming(1, { duration: 800 });
    }
  }, [displayArtwork, currentArtwork]);

  const currentArtworkStyle = useAnimatedStyle(() => {
    return {
      opacity: crossfadeProgress.value,
      transform: [{ scale: 0.95 + 0.05 * crossfadeProgress.value }],
    };
  });

  const prevArtworkStyle = useAnimatedStyle(() => {
    return {
      opacity: 1 - crossfadeProgress.value,
      transform: [{ scale: 1 - 0.05 * crossfadeProgress.value }],
      position: 'absolute',
      width: '100%',
      height: '100%',
      zIndex: -1,
    };
  });

  const totalSeconds = nativeProgress.duration > 0
    ? nativeProgress.duration
    : Math.max(track?.duration || 0, 1);
  const currentSeconds = nativeProgress.duration > 0
    ? nativeProgress.position
    : totalSeconds * progress;
  const displayedSeconds = seekDraft ?? currentSeconds;

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remSecs = secs % 60;
    return `${mins}:${remSecs < 10 ? '0' : ''}${remSecs}`;
  };

  const handleSeekToLyric = async (time: number) => {
    const safeTime = Math.max(0, Math.min(time, totalSeconds));
    try {
      await TrackPlayer.seekTo(safeTime);
    } catch (e) {
      console.error('Error seeking to lyric time:', e);
    } finally {
      setSeekDraft(null);
    }
  };

  // Sincronizar volumen nativo inicial
  useEffect(() => {
    TrackPlayer.getVolume().then((vol) => {
      if (typeof vol === 'number') setVolume(vol);
    }).catch(() => {});
  }, []);

  const handleVolumeChange = async (newVol: number) => {
    const clamped = Math.max(0, Math.min(1, newVol));
    setVolume(clamped);
    try {
      await TrackPlayer.setVolume(clamped);
    } catch (err) {
      console.warn('Error adjusting volume:', err);
    }
  };

  const volumePanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const touchX = evt.nativeEvent.locationX;
        handleVolumeChange(touchX / (volumeBarWidth || 200));
      },
      onPanResponderMove: (evt) => {
        const touchX = evt.nativeEvent.locationX;
        handleVolumeChange(touchX / (volumeBarWidth || 200));
      },
    })
  ).current;

  // Shuffle toggle con reordenamiento de cola futura
  const handleToggleShuffle = async () => {
    try {
      const nextShuffle = !isShuffleActive;
      setIsShuffleActive(nextShuffle);
      
      const queue = await TrackPlayer.getQueue();
      const currentIdx = await TrackPlayer.getActiveTrackIndex();
      
      if (nextShuffle && queue.length > 1) {
        if (isSmartDJActive) await onToggleSmartDJ?.();
        const futureTracks = queue.slice((currentIdx ?? 0) + 1);
        for (let i = futureTracks.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [futureTracks[i], futureTracks[j]] = [futureTracks[j], futureTracks[i]];
        }
        const firstFutureIndex = (currentIdx ?? 0) + 1;
        const futureIndexes = queue
          .map((_, index) => index)
          .filter((index) => index >= firstFutureIndex);
        if (futureIndexes.length > 0) {
          await TrackPlayer.remove(futureIndexes);
          await TrackPlayer.add(futureTracks, firstFutureIndex);
        }
      }
    } catch (err) {
      console.warn('Error en toggle shuffle:', err);
    }
  };

  // Repeat toggle
  const handleToggleRepeat = async () => {
    try {
      let nextMode = RepeatMode.Off;
      if (repeatMode === RepeatMode.Off) {
        nextMode = RepeatMode.Queue;
      } else if (repeatMode === RepeatMode.Queue) {
        nextMode = RepeatMode.Track;
      } else {
        nextMode = RepeatMode.Off;
      }
      setRepeatMode(nextMode);
      await TrackPlayer.setRepeatMode(nextMode);
    } catch (err) {
      console.warn('Error cambiando modo repeat:', err);
    }
  };

  // Lógica funcional del Sleep Timer segundo a segundo con fade-out progresivo
  useEffect(() => {
    if (!sleepTimerActive || sleepRemainingSeconds <= 0) {
      return;
    }
    const interval = setInterval(async () => {
      setSleepRemainingSeconds((prev) => {
        if (prev <= 1) {
          TrackPlayer.getVolume().then(async (currentVol = 0.85) => {
            for (let v = typeof currentVol === 'number' ? currentVol : 0.85; v >= 0; v -= 0.1) {
              await TrackPlayer.setVolume(Math.max(0, v));
              await new Promise<void>((r) => setTimeout(r, 80));
            }
            await TrackPlayer.pause();
            await TrackPlayer.setVolume(typeof currentVol === 'number' ? currentVol : 0.85);
          }).catch(() => TrackPlayer.pause());
          setSleepTimerActive(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [sleepTimerActive, sleepRemainingSeconds]);

  useEffect(() => {
    if (isOpen && lyricsRequestNonce > lastLyricsRequestRef.current) {
      lastLyricsRequestRef.current = lyricsRequestNonce;
      setShowLyricsModal(true);
    }
  }, [isOpen, lyricsRequestNonce]);

  useEffect(() => {
    if (isOpen && queueRequestNonce > lastQueueRequestRef.current) {
      lastQueueRequestRef.current = queueRequestNonce;
      setShowQueueModal(true);
    }
  }, [isOpen, queueRequestNonce]);

  useEffect(() => {
    setSeekDraft(null);
  }, [track?.id]);

  const handleSleepTimerPress = () => {
    if (!sleepTimerActive) {
      setSleepTimerActive(true);
      setSleepRemainingSeconds(15 * 60); // 15 Minutos
      Alert.alert('Sleep Timer', 'Temporizador activado: la música se apagará en 15 minutos.');
    } else if (sleepRemainingSeconds === 15 * 60) {
      setSleepRemainingSeconds(30 * 60); // 30 Minutos
      Alert.alert('Sleep Timer', 'Temporizador ajustado: 30 minutos.');
    } else if (sleepRemainingSeconds === 30 * 60) {
      setSleepRemainingSeconds(60 * 60); // 60 Minutos
      Alert.alert('Sleep Timer', 'Temporizador ajustado: 60 minutos.');
    } else {
      setSleepTimerActive(false);
      setSleepRemainingSeconds(0);
      Alert.alert('Sleep Timer', 'Sleep Timer desactivado.');
    }
  };

  useEffect(() => {
    if (isOpen && sleepTimerRequestNonce > lastSleepRequestRef.current) {
      lastSleepRequestRef.current = sleepTimerRequestNonce;
      handleSleepTimerPress();
    }
  }, [isOpen, sleepTimerRequestNonce]);

  if (!isOpen || !track) {
    return null;
  }

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, dismissStyle, { backgroundColor: colors.background }]}
      className="z-50"
      {...dismissPanResponder.panHandlers}
    >
      <View className="flex-1 pt-12 pb-6 px-6 justify-between">
        
        {/* Cabecera de Texto: Superior Izquierda (Título y Artista) con insignias a la derecha */}
        <View className="flex-row items-start justify-between mb-2">
          <View className="flex-1 mr-4">
            <Text
              className="text-2xl font-bold text-white tracking-tight"
              style={{ color: colors.foreground }}
              numberOfLines={1}
            >
              {track.title || 'Canción Sin Título'}
            </Text>
            <TouchableOpacity onPress={onOpenArtist} disabled={!onOpenArtist}>
              <Text
                className="text-base font-medium mt-0.5"
                style={{ color: colors.foreground }}
                numberOfLines={1}
              >
                {track.artist || 'Artista Desconocido'}
              </Text>
            </TouchableOpacity>
            {track.album ? (
              <TouchableOpacity onPress={onOpenAlbum} disabled={!onOpenAlbum}>
                <Text className="text-xs font-medium mt-0.5" style={{ color: colors.mutedForeground }} numberOfLines={1}>
                  {track.album}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Grupo de Acciones Superiores (MillaSmartDJ & Sleep Timer) */}
          <View className="flex-row items-center gap-2 pt-1">
            <TouchableOpacity
              onPress={onToggleSmartDJ}
              activeOpacity={0.8}
              className={`flex-row items-center gap-1.5 px-3 py-1.5 rounded-full border transition-all ${
                isSmartDJActive
                  ? 'bg-amber-500/20 border-amber-500 shadow-sm'
                  : 'bg-white/10 border-white/15'
              }`}
            >
              <Radio size={13} color={isSmartDJActive ? '#f59e0b' : '#a3a3a3'} />
              <Text
                className={`text-[10px] font-black tracking-wider uppercase ${
                  isSmartDJActive ? 'text-amber-400' : 'text-neutral-400'
                }`}
              >
                SmartDJ
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleSleepTimerPress}
              className={`w-9 h-9 rounded-full items-center justify-center transition-all border ${
                sleepTimerActive ? 'bg-indigo-500/20 border-indigo-500/50' : 'bg-white/10 border-white/15'
              }`}
            >
              <Moon size={16} color={sleepTimerActive ? '#818cf8' : '#a3a3a3'} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Carátula Central Perfectly Centered */}
        <View className="flex-1 items-center justify-center my-4 overflow-hidden">
          <View
            style={{ width: ARTWORK_SIZE, height: ARTWORK_SIZE, backgroundColor: colors.card, borderColor: colors.border }}
            className="rounded-2xl overflow-hidden shadow-2xl border"
          >
            {prevArtwork && (
              <Animated.Image
                source={{ uri: prevArtwork }}
                style={[prevArtworkStyle]}
                resizeMode="cover"
              />
            )}
            {currentArtwork && !currentArtworkFailed ? (
              <Animated.Image
                source={{ uri: currentArtwork }}
                style={[{ width: '100%', height: '100%' }, currentArtworkStyle]}
                resizeMode="cover"
                onError={() => setCurrentArtworkFailed(true)}
              />
            ) : (
              <Animated.View style={[{ width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center', backgroundColor: colors.card }, currentArtworkStyle]}>
                <Text className="text-xl font-bold" style={{ color: colors.mutedForeground }}>MILLA</Text>
              </Animated.View>
            )}
          </View>
        </View>

        {/* Sección Inferior: Slider, Botones de Control, Info Técnica y Filo Inferior */}
        <View className="w-full">
          {/* Barra de Progreso Seekbar limpia y delgada con indicador circular azul claro */}
          <View className="w-full mb-3">
            <Slider
              style={{ width: '100%', height: 26 }}
              minimumValue={0}
              maximumValue={totalSeconds}
              value={displayedSeconds}
              onSlidingStart={() => setSeekDraft(currentSeconds)}
              onValueChange={setSeekDraft}
              onSlidingComplete={(val) => handleSeekToLyric(val)}
              minimumTrackTintColor={colors.primary}
              maximumTrackTintColor={colors.border}
              thumbTintColor={colors.primary}
            />
            <View className="flex-row justify-between items-center px-1 -mt-1">
              <Text className="text-xs font-semibold" style={{ color: colors.mutedForeground }}>
                {formatTime(Math.floor(displayedSeconds))}
              </Text>
              <Text className="text-xs font-semibold" style={{ color: colors.mutedForeground }}>
                {formatTime(Math.floor(totalSeconds))}
              </Text>
            </View>
          </View>

          {/* Controles Principales de Reproducción */}
          <View className="flex-row justify-between items-center px-4 my-2">
            <TouchableOpacity onPress={handleToggleShuffle} className="p-2">
              <Shuffle size={22} color={isShuffleActive ? '#bae6fd' : '#a3a3a3'} />
            </TouchableOpacity>

            <TouchableOpacity onPress={onPrev} className="p-2">
              <SkipBack size={28} color={colors.foreground} />
            </TouchableOpacity>

            {/* Play / Pause dentro de contenedor cuadrado redondeado azul claro */}
            <TouchableOpacity
              onPress={onPlayPause}
              activeOpacity={0.85}
              className="w-16 h-14 rounded-2xl justify-center items-center shadow-xl"
              style={{ backgroundColor: colors.primary }}
            >
              {isPlaying ? (
                <Pause size={28} color={colors.primaryForeground} fill={colors.primaryForeground} />
              ) : (
                <Play
                  size={28}
                  color={colors.primaryForeground}
                  fill={colors.primaryForeground}
                  style={{ marginLeft: 3 }}
                />
              )}
            </TouchableOpacity>

            <TouchableOpacity onPress={onNext} className="p-2">
              <SkipForward size={28} color={colors.foreground} />
            </TouchableOpacity>

            <TouchableOpacity onPress={handleToggleRepeat} className="p-2 relative">
              <Repeat size={22} color={repeatMode !== RepeatMode.Off ? '#bae6fd' : '#a3a3a3'} />
              {repeatMode === RepeatMode.Track && (
                <View className="absolute bottom-1 right-1 w-2.5 h-2.5 rounded-full bg-[#bae6fd] items-center justify-center">
                  <Text className="text-[7px] font-black text-black">1</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>

          {/* Fila técnica discreta abajo indicando el formato y calidad */}
          <Text className="text-xs font-semibold text-neutral-500 text-center mt-3 mb-4 tracking-wide">
            {track.qualityBadge || 'MP3 • 128 kb/s • 44.1 kHz'}
          </Text>

          {/* Barra de herramientas en el filo inferior */}
          <View className="flex-row justify-between items-center pt-3 border-t border-white/10 px-2">
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
              className="p-2"
            >
              <ChevronDown size={24} color="#a3a3a3" />
            </TouchableOpacity>

            <View className="flex-row items-center gap-6">
              <TouchableOpacity onPress={handleSleepTimerPress} className="p-1">
                <Moon size={22} color={sleepTimerActive ? '#818cf8' : '#a3a3a3'} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setShowLyricsModal(true)} className="p-1">
                <MicVocal size={22} color={showLyricsModal ? '#bae6fd' : '#a3a3a3'} />
              </TouchableOpacity>
              <LiquidHeartButton liked={isLiked} onPress={onToggleLike} size={22} />
              <TouchableOpacity onPress={() => setShowQueueModal(true)} className="p-1">
                <ListMusic size={22} color={showQueueModal ? '#bae6fd' : '#a3a3a3'} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setShowOptionsModal(true)} className="p-1">
                <MoreVertical size={22} color="#a3a3a3" />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <LyricsModal
          isOpen={showLyricsModal}
          onClose={() => setShowLyricsModal(false)}
          track={track}
          progress={progress}
          currentTheme={currentTheme}
          isPlaying={isPlaying}
          onPlayPause={onPlayPause}
          onNext={onNext}
          onPrev={onPrev}
          isLiked={isLiked}
          onToggleLike={onToggleLike}
          onOpenQueue={() => {
            setShowLyricsModal(false);
            setShowQueueModal(true);
          }}
        />

        <QueueScreen
          isOpen={showQueueModal}
          onClose={() => setShowQueueModal(false)}
          onOpenLyrics={() => {
            setShowQueueModal(false);
            setShowLyricsModal(true);
          }}
        />

        <TrackOptionsModal
          visible={showOptionsModal}
          track={track}
          onClose={() => setShowOptionsModal(false)}
          onGoToLyrics={() => {
            setShowOptionsModal(false);
            setShowLyricsModal(true);
          }}
        />
      </View>
    </Animated.View>
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
