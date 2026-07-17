import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Heart,
  Mic,
  ListPlus,
  Clock,
  ListMusic,
  Cast,
  Disc,
} from 'lucide-react-native';
import TrackPlayer, {
  useProgress,
  usePlaybackState,
  useActiveTrack,
  State,
} from 'react-native-track-player';

export interface Track {
  id: string;
  title: string;
  artist: string;
  album?: string;
  artwork?: string;
  duration?: number;
  qualityBadge?: string;
  url?: string;
  artwork_thumb?: string;
  bpm?: number;
  key?: string;
  camelot_key?: string;
  replayGainTrack?: number;
  replayGainAlbum?: number;
  needs_repair?: boolean;
  needs_sync?: boolean;
  lyrics_json?: string;
  lyrics_lrc?: string;
  lyrics?: string;
  genre?: string;
  play_count?: number;
  last_played?: number;
}

export interface MiniPlayerProps {
  track: Track | null;
  isPlaying?: boolean;
  progress?: number; // 0.0 a 1.0
  currentTheme?: string;
  isLiked?: boolean;
  onPlayPause?: () => void;
  onNext?: () => void;
  onPrev?: () => void;
  onToggleLike?: () => void;
  onPressBar?: () => void;
}

const formatTime = (secs?: number): string => {
  if (!secs || isNaN(secs) || secs <= 0) return '0:00';
  const totalSecs = Math.floor(secs);
  const mins = Math.floor(totalSecs / 60);
  const remainingSecs = totalSecs % 60;
  return `${mins}:${remainingSecs.toString().padStart(2, '0')}`;
};

export const MiniPlayer: React.FC<MiniPlayerProps> = ({
  track,
  isPlaying,
  progress = 0,
  isLiked = false,
  onPlayPause,
  onNext,
  onPrev,
  onToggleLike,
  onPressBar,
}) => {
  // Conexión en vivo con react-native-track-player
  const progressData = useProgress();
  const activeTrackData = useActiveTrack();
  const playbackState = usePlaybackState();

  // Pista actual combinada (hook nativo o fallback por props)
  const displayTrack = (activeTrackData as unknown as Track) || track;

  if (!displayTrack) {
    return null;
  }

  // Estado de reproducción combinado
  const hookIsPlaying =
    typeof playbackState === 'object' && playbackState !== null
      ? playbackState.state === State.Playing
      : playbackState === State.Playing;
  const activeIsPlaying =
    typeof hookIsPlaying === 'boolean' ? hookIsPlaying : (isPlaying ?? false);

  // Progreso en segundos y porcentaje combinados
  const totalSecs =
    progressData.duration > 0 ? progressData.duration : (displayTrack.duration || 0);
  const currentSecs =
    progressData.position > 0 ? progressData.position : progress * totalSecs;
  const activeProgress =
    totalSecs > 0 ? Math.min(Math.max(currentSecs / totalSecs, 0), 1) : Math.min(Math.max(progress, 0), 1);

  const displayArtwork = (displayTrack as any).artwork_thumb || displayTrack.artwork;

  // Manejadores de control enlazados a TrackPlayer si no se pasan por props o en adición a ellas
  const handlePlayPause = async () => {
    if (onPlayPause) {
      onPlayPause();
    } else {
      try {
        if (activeIsPlaying) {
          await TrackPlayer.pause();
        } else {
          await TrackPlayer.play();
        }
      } catch (err) {
        console.warn('Playback error in MiniPlayer:', err);
      }
    }
  };

  const handleNext = async () => {
    if (onNext) {
      onNext();
    } else {
      try {
        await TrackPlayer.skipToNext();
      } catch (err) {
        console.warn('Next skip error in MiniPlayer:', err);
      }
    }
  };

  const handlePrev = async () => {
    if (onPrev) {
      onPrev();
    } else {
      try {
        await TrackPlayer.skipToPrevious();
      } catch (err) {
        console.warn('Prev skip error in MiniPlayer:', err);
      }
    }
  };

  return (
    <View className="mx-3 mb-2 rounded-2xl bg-[#151617] border border-neutral-800/90 shadow-2xl overflow-hidden p-3.5">
      {/* FILA SUPERIOR: Información (Izquierda) y Acciones Rápidas (Derecha) */}
      <View className="flex-row items-center justify-between mb-3">
        {/* Izquierda: Carátula, Título, Álbum y Artista */}
        <TouchableOpacity
          activeOpacity={0.88}
          onPress={onPressBar}
          className="flex-row items-center flex-1 mr-3"
        >
          <View className="w-12 h-12 rounded-lg bg-neutral-800 overflow-hidden mr-3 border border-neutral-700/50 items-center justify-center">
            {displayArtwork ? (
              <Image
                source={{ uri: displayArtwork }}
                className="w-full h-full"
                resizeMode="cover"
              />
            ) : (
              <Disc size={24} color="#6B7280" />
            )}
          </View>

          <View className="flex-1 justify-center">
            <Text
              className="text-sm font-bold text-white tracking-tight leading-tight mb-0.5"
              numberOfLines={1}
            >
              {displayTrack.title}
            </Text>
            {displayTrack.album ? (
              <Text
                className="text-xs text-gray-400 font-medium leading-tight truncate"
                numberOfLines={1}
              >
                {displayTrack.album}
              </Text>
            ) : null}
            <Text
              className="text-xs text-gray-400 font-medium leading-tight truncate"
              numberOfLines={1}
            >
              {displayTrack.artist}
            </Text>
          </View>
        </TouchableOpacity>

        {/* Derecha: Fila exacta de 5 Iconos de Utilidad en color gris claro/blanco sutil */}
        <View className="flex-row items-center gap-3">
          {/* 1. Corazón (Favorita) */}
          <TouchableOpacity
            onPress={onToggleLike}
            hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
            className="p-1"
          >
            <Heart
              size={18}
              color={isLiked ? '#ef4444' : '#9CA3AF'}
              fill={isLiked ? '#ef4444' : 'transparent'}
            />
          </TouchableOpacity>

          {/* 2. Micrófono (Letras) */}
          <TouchableOpacity
            onPress={onPressBar}
            hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
            className="p-1"
          >
            <Mic size={18} color="#9CA3AF" />
          </TouchableOpacity>

          {/* 3. Añadir a lista de reproducción */}
          <TouchableOpacity
            onPress={() => {}}
            hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
            className="p-1"
          >
            <ListPlus size={18} color="#9CA3AF" />
          </TouchableOpacity>

          {/* 4. Reloj (Temporizador / Sleep Timer) */}
          <TouchableOpacity
            onPress={onPressBar}
            hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
            className="p-1"
          >
            <Clock size={18} color="#9CA3AF" />
          </TouchableOpacity>

          {/* 5. Lista de Reproducción / Cola */}
          <TouchableOpacity
            onPress={onPressBar}
            hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
            className="p-1"
          >
            <ListMusic size={18} color="#9CA3AF" />
          </TouchableOpacity>
        </View>
      </View>

      {/* FILA MEDIA: Barra de Progreso Integrada */}
      <View className="flex-row items-center justify-between my-1.5">
        <Text className="text-[11px] font-medium text-gray-400 w-8 text-left">
          {formatTime(currentSecs)}
        </Text>

        <View className="flex-1 mx-2 h-1.5 bg-neutral-800 rounded-full relative justify-center">
          {/* Progreso transcurrido */}
          <View
            className="h-full bg-neutral-600 rounded-full"
            style={{ width: `${activeProgress * 100}%` }}
          />
          {/* Indicador de arrastre (Thumb) redondo naranja quemado / óxido (#B43C12) */}
          <View
            style={{
              backgroundColor: '#B43C12',
              left: `${Math.min(Math.max(activeProgress * 100, 0), 95)}%`,
              marginLeft: -6,
            }}
            className="w-3.5 h-3.5 rounded-full absolute top-[-4px] shadow-md"
          />
        </View>

        <Text className="text-[11px] font-medium text-gray-400 w-8 text-right">
          {formatTime(totalSecs)}
        </Text>
      </View>

      {/* FILA INFERIOR: Controles de Navegación y Transmisión */}
      <View className="flex-row items-center justify-between mt-2.5 px-1 relative">
        {/* Espaciador izquierdo del mismo tamaño que el botón Cast para un centrado geométrico exacto */}
        <View className="w-10 items-start justify-center" />

        {/* Controles Centrales: Anterior | Play/Pausa (#B43C12) | Siguiente */}
        <View className="flex-row items-center justify-center gap-8">
          <TouchableOpacity
            onPress={(e) => {
              e.stopPropagation();
              handlePrev();
            }}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            className="p-1"
          >
            <SkipBack size={24} color="#E5E7EB" />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={(e) => {
              e.stopPropagation();
              handlePlayPause();
            }}
            activeOpacity={0.8}
            style={{ backgroundColor: '#B43C12' }}
            className="w-11 h-11 rounded-full items-center justify-center shadow-lg"
          >
            {activeIsPlaying ? (
              <Pause size={20} color="#FFFFFF" fill="#FFFFFF" />
            ) : (
              <Play size={20} color="#FFFFFF" fill="#FFFFFF" style={{ marginLeft: 2 }} />
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={(e) => {
              e.stopPropagation();
              handleNext();
            }}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            className="p-1"
          >
            <SkipForward size={24} color="#E5E7EB" />
          </TouchableOpacity>
        </View>

        {/* Extremo Derecho: Botón de Cast Condicionado */}
        <View className="w-10 items-end justify-center">
          {activeIsPlaying && (
            <TouchableOpacity
              onPress={(e) => {
                e.stopPropagation();
              }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              className="p-1.5 rounded-lg bg-white/10 border border-white/20 items-center justify-center shadow-lg"
            >
              <Cast size={18} color="#FFFFFF" />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
};
