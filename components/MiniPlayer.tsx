import React, { useEffect, useState } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Mic,
  ListPlus,
  Clock,
  ListMusic,
  Cast,
  Disc,
} from 'lucide-react-native';
import { LiquidHeartButton } from './LiquidHeartButton';
import { useTheme } from '../context/ThemeContext';
import TrackPlayer, {
  useProgress,
  usePlaybackState,
  useActiveTrack,
  State,
} from '../services/player-engine';

export interface Track {
  id: string;
  title: string;
  artist: string;
  album?: string;
  artwork?: string;
  duration?: number;
  qualityBadge?: string;
  url?: string;
  /** Original Android MediaStore/SAF URI kept when `url` is materialized to app cache. */
  source_uri?: string;
  /** File extension retained when a virtual content URI has no filename. */
  file_extension?: string;
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
  lyrics_ttml?: string;
  lyrics_plain?: string;
  lyrics_source?: 'embedded_ttml' | 'embedded_lrc' | 'embedded_plain' | 'companion_lrc' | 'api' | string;
  lyrics?: string;
  genre?: string;
  play_count?: number;
  last_played?: number;
  vocal_silence_start_ms?: number;
  vocal_silence_end_ms?: number;
  intro_duration_ms?: number;
  outro_duration_ms?: number;
  outro_start_ms?: number;
  intro_energy?: number;
  outro_energy?: number;
  beat_interval_ms?: number;
  analysis_version?: string;
  analysis_status?: 'pending' | 'processing' | 'ready' | 'failed' | string;
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
  onOpenLyrics?: () => void;
  onAddToPlaylist?: () => void;
  onSleepTimer?: () => void;
  onOpenQueue?: () => void;
  onCast?: () => void;
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
  onOpenLyrics,
  onAddToPlaylist,
  onSleepTimer,
  onOpenQueue,
  onCast,
}) => {
  const { colors } = useTheme();
  // Conexion en vivo con el motor nativo Expo Audio.
  const progressData = useProgress();
  const activeTrackData = useActiveTrack();
  const playbackState = usePlaybackState();
  const [artworkFailed, setArtworkFailed] = useState(false);

  // Pista actual combinada (hook nativo o fallback por props)
  const displayTrack = (activeTrackData as unknown as Track) || track;

  useEffect(() => {
    setArtworkFailed(false);
  }, [displayTrack?.id, displayTrack?.artwork, displayTrack?.artwork_thumb]);

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
    <View
      className="mx-3 mb-2 rounded-2xl border shadow-2xl overflow-hidden p-3.5"
      style={{ backgroundColor: colors.card, borderColor: colors.border }}
    >
      {/* FILA SUPERIOR: Información (Izquierda) y Acciones Rápidas (Derecha) */}
      <View className="flex-row items-center justify-between mb-3">
        {/* Izquierda: Carátula, Título, Álbum y Artista */}
        <TouchableOpacity
          activeOpacity={0.88}
          onPress={onPressBar}
          className="flex-row items-center flex-1 mr-3"
        >
          <View className="w-12 h-12 rounded-lg overflow-hidden mr-3 border items-center justify-center" style={{ backgroundColor: colors.muted, borderColor: colors.border }}>
            {displayArtwork && !artworkFailed ? (
              <Image
                source={{ uri: displayArtwork }}
                className="w-full h-full"
                resizeMode="cover"
                onError={() => setArtworkFailed(true)}
              />
            ) : (
              <Disc size={24} color={colors.mutedForeground} />
            )}
          </View>

          <View className="flex-1 justify-center">
            <Text
              className="text-sm font-bold text-white tracking-tight leading-tight mb-0.5"
              style={{ color: colors.foreground }}
              numberOfLines={1}
            >
              {displayTrack.title}
            </Text>
            {displayTrack.album ? (
              <Text
                className="text-xs text-gray-400 font-medium leading-tight truncate"
                style={{ color: colors.mutedForeground }}
                numberOfLines={1}
              >
                {displayTrack.album}
              </Text>
            ) : null}
            <Text
              className="text-xs text-gray-400 font-medium leading-tight truncate"
              style={{ color: colors.mutedForeground }}
              numberOfLines={1}
            >
              {displayTrack.artist}
            </Text>
          </View>
        </TouchableOpacity>

        {/* Derecha: Fila exacta de 5 Iconos de Utilidad en color gris claro/blanco sutil */}
        <View className="flex-row items-center gap-3">
          {/* 1. Corazón (Favorita) */}
          <LiquidHeartButton
            liked={isLiked}
            onPress={onToggleLike}
            size={18}
            inactiveColor={colors.mutedForeground}
          />

          {/* 2. Micrófono (Letras) */}
          <TouchableOpacity
            onPress={onOpenLyrics || onPressBar}
            hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
            className="p-1"
          >
            <Mic size={18} color={colors.mutedForeground} />
          </TouchableOpacity>

          {/* 3. Añadir a lista de reproducción */}
          <TouchableOpacity
            onPress={onAddToPlaylist}
            hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
            className="p-1"
          >
            <ListPlus size={18} color={colors.mutedForeground} />
          </TouchableOpacity>

          {/* 4. Reloj (Temporizador / Sleep Timer) */}
          <TouchableOpacity
            onPress={onSleepTimer || onPressBar}
            hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
            className="p-1"
          >
            <Clock size={18} color={colors.mutedForeground} />
          </TouchableOpacity>

          {/* 5. Lista de Reproducción / Cola */}
          <TouchableOpacity
            onPress={onOpenQueue || onPressBar}
            hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
            className="p-1"
          >
            <ListMusic size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>
      </View>

      {/* FILA MEDIA: Barra de Progreso Integrada */}
      <View className="flex-row items-center justify-between my-1.5">
        <Text className="text-[11px] font-medium w-8 text-left" style={{ color: colors.mutedForeground }}>
          {formatTime(currentSecs)}
        </Text>

        <View className="flex-1 mx-2 h-1.5 rounded-full relative justify-center" style={{ backgroundColor: colors.muted }}>
          {/* Progreso transcurrido */}
          <View
            className="h-full rounded-full"
            style={{ width: `${activeProgress * 100}%`, backgroundColor: colors.mutedForeground }}
          />
          {/* Indicador de arrastre (Thumb) redondo naranja quemado / óxido (#B43C12) */}
          <View
            style={{
              backgroundColor: colors.primary,
              left: `${Math.min(Math.max(activeProgress * 100, 0), 95)}%`,
              marginLeft: -6,
            }}
            className="w-3.5 h-3.5 rounded-full absolute top-[-4px] shadow-md"
          />
        </View>

        <Text className="text-[11px] font-medium w-8 text-right" style={{ color: colors.mutedForeground }}>
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
            <SkipBack size={24} color={colors.foreground} />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={(e) => {
              e.stopPropagation();
              handlePlayPause();
            }}
            activeOpacity={0.8}
            style={{ backgroundColor: colors.primary }}
            className="w-11 h-11 rounded-full items-center justify-center shadow-lg"
          >
            {activeIsPlaying ? (
              <Pause size={20} color={colors.primaryForeground} fill={colors.primaryForeground} />
            ) : (
              <Play size={20} color={colors.primaryForeground} fill={colors.primaryForeground} style={{ marginLeft: 2 }} />
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
            <SkipForward size={24} color={colors.foreground} />
          </TouchableOpacity>
        </View>

        {/* Extremo Derecho: Botón de Cast Condicionado */}
        <View className="w-10 items-end justify-center">
          {activeIsPlaying && (
            <TouchableOpacity
              onPress={(e) => {
                e.stopPropagation();
                onCast?.();
              }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              className="p-1.5 rounded-lg border items-center justify-center shadow-lg"
              style={{ backgroundColor: colors.secondary, borderColor: colors.border }}
            >
              <Cast size={18} color={colors.foreground} />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
};
