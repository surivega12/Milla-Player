import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import { Play, Pause, SkipBack, SkipForward, Heart } from 'lucide-react-native';
import { getThemeColors } from '../utils/theme-colors';

export interface Track {
  id: string;
  title: string;
  artist: string;
  album?: string;
  artwork?: string;
  duration?: number;
  qualityBadge?: string;
}

interface PlayerBarProps {
  track: Track | null;
  isPlaying: boolean;
  progress: number; // 0.0 a 1.0
  currentTheme?: string;
  isLiked?: boolean;
  onPlayPause: () => void;
  onNext: () => void;
  onPrev: () => void;
  onToggleLike?: () => void;
  onPressBar: () => void;
}

export const PlayerBar: React.FC<PlayerBarProps> = ({
  track,
  isPlaying,
  progress,
  currentTheme = 'theme-monochrome',
  isLiked = false,
  onPlayPause,
  onNext,
  onPrev,
  onToggleLike,
  onPressBar,
}) => {
  const colors = getThemeColors(currentTheme);

  if (!track) {
    return null;
  }

  return (
    <View className="mx-3 mb-4 rounded-2xl overflow-hidden border border-[var(--border)]/60 shadow-2xl">
      {/* Fondo translúcido con expo-blur para efecto cristalino flotante */}
      <BlurView intensity={75} tint="dark" style={StyleSheet.absoluteFill} />
      <View className="bg-[var(--card)]/80">
        
        {/* Línea superior de progreso Hi-Res */}
        <View className="h-[3px] w-full bg-[var(--secondary)]">
          <View
            className="h-full bg-[var(--primary)]"
            style={{ width: `${Math.min(Math.max(progress * 100, 0), 100)}%` }}
          />
        </View>

        {/* Contenido principal de la barra */}
        <TouchableOpacity
          activeOpacity={0.88}
          onPress={onPressBar}
          className="flex-row items-center justify-between px-3 py-2.5"
        >
          {/* Miniatura de Carátula y Metadatos */}
          <View className="flex-row items-center flex-1 mr-3">
            <View className="w-11 h-11 rounded-lg bg-[var(--secondary)] overflow-hidden mr-3 border border-[var(--border)]/40 shadow-sm">
              {track.artwork ? (
                <Image
                  source={{ uri: track.artwork }}
                  className="w-full h-full"
                  resizeMode="cover"
                />
              ) : (
                <View className="w-full h-full justify-center items-center bg-[var(--muted)]">
                  <Text className="text-[10px] text-[var(--muted-foreground)] font-bold">FLAC</Text>
                </View>
              )}
            </View>

            <View className="flex-1 justify-center">
              <Text
                className="text-sm font-bold text-[var(--foreground)] tracking-tight"
                numberOfLines={1}
              >
                {track.title}
              </Text>
              <Text
                className="text-xs font-medium text-[var(--muted-foreground)] mt-0.5"
                numberOfLines={1}
              >
                {track.artist}
              </Text>
            </View>
          </View>

          {/* Controles Rápida Reproducción */}
          <View className="flex-row items-center gap-3">
            {/* Botón Me Gusta */}
            {onToggleLike && (
              <TouchableOpacity
                onPress={onToggleLike}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                className="p-1"
              >
                <Heart
                  size={20}
                  color={isLiked ? '#ef4444' : colors.mutedForeground}
                  fill={isLiked ? '#ef4444' : 'transparent'}
                />
              </TouchableOpacity>
            )}

            {/* Anterior */}
            <TouchableOpacity
              onPress={onPrev}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              className="p-1"
            >
              <SkipBack size={20} color={colors.foreground} />
            </TouchableOpacity>

            {/* Play / Pause Central */}
            <TouchableOpacity
              onPress={onPlayPause}
              activeOpacity={0.8}
              className="w-10 h-10 rounded-full bg-[var(--primary)] justify-center items-center shadow-md"
            >
              {isPlaying ? (
                <Pause size={20} color={colors.primaryForeground} fill={colors.primaryForeground} />
              ) : (
                <Play
                  size={20}
                  color={colors.primaryForeground}
                  fill={colors.primaryForeground}
                  style={{ marginLeft: 2 }}
                />
              )}
            </TouchableOpacity>

            {/* Siguiente */}
            <TouchableOpacity
              onPress={onNext}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              className="p-1"
            >
              <SkipForward size={20} color={colors.foreground} />
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </View>
    </View>
  );
};
