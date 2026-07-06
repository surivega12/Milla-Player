import React from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { Menu, Sparkles, Play, Disc, Palette, FolderOpen, Download, ArrowDownToLine, AlertTriangle, Hammer } from 'lucide-react-native';
import { Track } from '../components/PlayerBar';
import { getThemeColors } from '../utils/theme-colors';

const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - 48) / 2;

export const SAMPLE_CATALOG: Track[] = [
  {
    id: 'track-1',
    title: 'Monochrome Symphony',
    artist: 'Milla Orchestra',
    album: 'Cybernetic Hi-Fi',
    duration: 245,
    qualityBadge: 'FLAC 24-bit/192kHz',
    artwork: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&q=80',
  },
  {
    id: 'track-2',
    title: 'Deep Forest FLAC',
    artist: 'Nordic Audio Collective',
    album: 'Scandinavian Echoes',
    duration: 312,
    qualityBadge: 'FLAC 24-bit/96kHz',
    artwork: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=600&q=80',
  },
  {
    id: 'track-3',
    title: 'Purple Horizon 192kHz',
    artist: 'Synthwave Dreams',
    album: 'Neon Grid 1984',
    duration: 198,
    qualityBadge: 'FLAC 24-bit/192kHz',
    artwork: 'https://images.unsplash.com/photo-1508739773434-c26b3d09e071?w=600&q=80',
  },
  {
    id: 'track-4',
    title: 'Acoustic Gold Standard',
    artist: 'Elena Rostova',
    album: 'Live at Vienna Hall',
    duration: 276,
    qualityBadge: 'DSD 5.6MHz Direct',
    artwork: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&q=80',
  },
  {
    id: 'track-5',
    title: 'Midnight Abyssal Sound',
    artist: 'Sub-Oceanic',
    album: 'Mariana Trench',
    duration: 354,
    qualityBadge: 'FLAC 16-bit/44.1kHz',
    artwork: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=600&q=80',
  },
  {
    id: 'track-6',
    title: 'Analog Warmth Vinyl',
    artist: 'The Vacuum Tubes',
    album: 'Pure Voltage',
    duration: 215,
    qualityBadge: 'FLAC 24-bit/192kHz',
    artwork: 'https://images.unsplash.com/photo-1461784121038-f088ca1e7714?w=600&q=80',
  },
];

const THEME_LIST = [
  { id: 'theme-monochrome', name: 'Monochrome', color: '#0a0a0a', border: '#f5f5f5' },
  { id: 'theme-dark', name: 'Dark Blue', color: '#1a1a1a', border: '#3b82f6' },
  { id: 'theme-ocean', name: 'Ocean', color: '#0c1821', border: '#06b6d4' },
  { id: 'theme-purple', name: 'Purple', color: '#0f0514', border: '#a855f7' },
  { id: 'theme-forest', name: 'Forest', color: '#0a1409', border: '#22c55e' },
  { id: 'theme-mocha', name: 'Mocha', color: '#1e1e2e', border: '#89b4fa' },
  { id: 'theme-macchiato', name: 'Macchiato', color: '#24273a', border: '#8aadf4' },
  { id: 'theme-frappe', name: 'Frappé', color: '#303446', border: '#8caaee' },
  { id: 'theme-latte', name: 'Latte', color: '#eff1f5', border: '#1e66f5' },
  { id: 'theme-white', name: 'White', color: '#f5f5f5', border: '#1a1a1a' },
];

interface HomeScreenProps {
  onOpenSidebar: () => void;
  onSelectTrack: (track: Track) => void;
  currentTrackId?: string;
  currentTheme: string;
  onSelectTheme: (theme: string) => void;
  tracks: Track[];
  onScanLocal: () => void;
  isScanning: boolean;
  downloadedIds: Set<string>;
  downloadProgress: Record<string, number>;
  onDownloadTrack: (track: Track) => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  onOpenSidebar,
  onSelectTrack,
  currentTrackId,
  currentTheme,
  onSelectTheme,
  tracks,
  onScanLocal,
  isScanning,
  downloadedIds,
  downloadProgress,
  onDownloadTrack,
}) => {
  const colors = getThemeColors(currentTheme);

  // Detectar pistas corruptas
  const tracksNeedingRepair = tracks.filter(t => (t as any).needs_repair).length;

  return (
    <View className="flex-1">
      {/* Cabecera Superior (Top Nav) */}
      <View className="flex-row items-center justify-between px-5 pt-14 pb-4">
        <TouchableOpacity
          onPress={onOpenSidebar}
          hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
          className="w-10 h-10 rounded-xl bg-[var(--card)]/80 border border-[var(--border)]/60 items-center justify-center shadow-md"
        >
          <Menu size={22} color={colors.foreground} />
        </TouchableOpacity>

        <View className="items-center">
          <Text className="text-xs font-black tracking-widest text-[var(--muted-foreground)] uppercase">
            Local Hi-Res Catalog
          </Text>
          <Text className="text-lg font-black tracking-wide text-[var(--foreground)]">
            MILLA LIBRARY
          </Text>
        </View>

        <View className="w-10 h-10 rounded-xl bg-[var(--primary)]/15 border border-[var(--primary)]/40 items-center justify-center">
          <Disc size={20} color={colors.primary} />
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        
        {/* Selector Rápido de 10 Temas Monochrome */}
        <View className="mt-2 mb-6">
          <View className="flex-row items-center gap-2 px-5 mb-3">
            <Palette size={14} color={colors.mutedForeground} />
            <Text className="text-xs font-bold tracking-wider text-[var(--muted-foreground)] uppercase">
              Monochrome Themes ({THEME_LIST.length})
            </Text>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 20, gap: 10 }}
          >
            {THEME_LIST.map((t) => {
              const isSelected = currentTheme === t.id;
              return (
                <TouchableOpacity
                  key={t.id}
                  onPress={() => onSelectTheme(t.id)}
                  activeOpacity={0.8}
                  className={`flex-row items-center gap-2 px-3.5 py-2 rounded-full border transition-all ${
                    isSelected
                      ? 'bg-[var(--primary)] border-[var(--primary)] shadow-md'
                      : 'bg-[var(--card)]/80 border-[var(--border)]/60'
                  }`}
                >
                  <View
                    style={{ backgroundColor: t.color, borderColor: t.border, borderWidth: 1.5 }}
                    className="w-3.5 h-3.5 rounded-full"
                  />
                  <Text
                    className={`text-xs font-bold ${
                      isSelected
                        ? 'text-[var(--primary-foreground)] font-black'
                        : 'text-[var(--foreground)]'
                    }`}
                  >
                    {t.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Sección Destacada / Banner */}
        <View className="mx-5 mb-8 p-6 rounded-3xl bg-[var(--card)]/80 border border-[var(--border)]/80 shadow-2xl overflow-hidden">
          <View className="flex-row items-center gap-2 mb-2">
            <Sparkles size={16} color={colors.primary} />
            <Text className="text-xs font-bold uppercase tracking-widest text-[var(--primary)]">
              Pure Native Engine
            </Text>
          </View>
          <Text className="text-2xl font-black text-[var(--foreground)] leading-tight">
            Lossless FLAC & DSD Playback
          </Text>
          <Text className="text-xs text-[var(--muted-foreground)] mt-2 leading-relaxed">
            Milla se conecta directamente a la arquitectura de audio nativa de tu dispositivo, eliminando el remuestreo del navegador. Escanea tu biblioteca local para encontrar archivos de alta resolución.
          </Text>

          {/* Botón de Escaneo Local */}
          <TouchableOpacity
            onPress={onScanLocal}
            disabled={isScanning}
            className="mt-5 py-3 px-4 rounded-xl bg-[var(--primary)] items-center justify-center flex-row gap-2 shadow-lg"
            style={{ opacity: isScanning ? 0.7 : 1 }}
          >
            {isScanning ? (
              <ActivityIndicator size="small" color={colors.primaryForeground} />
            ) : (
              <FolderOpen size={16} color={colors.primaryForeground} />
            )}
            <Text className="text-xs font-black uppercase tracking-wider text-[var(--primary-foreground)]">
              {isScanning ? 'Scanning Music...' : 'Scan Local Music Library'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Tarjeta de Reparación de Metadatos (Se muestra solo si hay pistas dañadas) */}
        {tracksNeedingRepair > 0 && (
          <View className="mx-5 mb-8 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex-row items-center shadow-sm">
            <View className="w-10 h-10 rounded-full bg-amber-500/20 items-center justify-center mr-3">
              <AlertTriangle size={20} color="#f59e0b" />
            </View>
            <View className="flex-1">
              <Text className="text-sm font-black text-amber-500 tracking-wide">
                METADATOS INCOMPLETOS
              </Text>
              <Text className="text-xs font-medium text-[var(--muted-foreground)] mt-0.5">
                {tracksNeedingRepair} pista(s) necesitan reparación.
              </Text>
            </View>
            <TouchableOpacity className="py-2 px-3 rounded-lg bg-amber-500 flex-row items-center gap-1.5 shadow-md">
              <Hammer size={14} color="#ffffff" />
              <Text className="text-xs font-black text-white uppercase">Reparar</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Cuadrícula de Pistas / Álbumes */}
        <View className="px-5">
          <Text className="text-base font-black tracking-wide text-[var(--foreground)] mb-4">
            {tracks.length > SAMPLE_CATALOG.length ? 'YOUR MUSIC LIBRARY' : 'FEATURED HI-RES ALBUMS'}
          </Text>

          <View className="flex-row flex-wrap justify-between gap-y-6">
            {tracks.map((track) => {
              const isCurrent = currentTrackId === track.id;
              const isDownloaded = downloadedIds.has(track.id);
              const progressVal = downloadProgress[track.id];

              // Usar miniatura optimizada en la lista para 120Hz fluido
              const displayArtwork = (track as any).artwork_thumb || track.artwork;

              return (
                <TouchableOpacity
                  key={track.id}
                  style={{ width: CARD_WIDTH }}
                  activeOpacity={0.85}
                  onPress={() => onSelectTrack(track)}
                  className={`rounded-2xl p-3 bg-[var(--card)]/90 border transition-all shadow-lg ${
                    isCurrent
                      ? 'border-[var(--primary)] border-2 shadow-2xl'
                      : 'border-[var(--border)]/60'
                  }`}
                >
                  {/* Carátula del Álbum */}
                  <View className="w-full aspect-square rounded-xl overflow-hidden bg-[var(--secondary)] mb-3 relative shadow-md">
                    {displayArtwork ? (
                      <Image
                        source={{ uri: displayArtwork }}
                        className="w-full h-full"
                        resizeMode="cover"
                      />
                    ) : (
                      <View className="w-full h-full justify-center items-center bg-[var(--muted)]">
                        <Disc size={40} color={colors.mutedForeground} />
                      </View>
                    )}
                    
                    {/* Botón Flotante de Play */}
                    <View className="absolute bottom-2 right-2 w-10 h-10 rounded-full bg-[var(--primary)] items-center justify-center shadow-lg">
                      <Play
                         size={18}
                        color={colors.primaryForeground}
                        fill={colors.primaryForeground}
                        style={{ marginLeft: 2 }}
                      />
                    </View>

                    {/* Botón de Descarga / Estado Offline */}
                    {track.id.startsWith('track-') && (
                      <View className="absolute top-2 right-2 z-20">
                        {isDownloaded ? (
                          <View className="w-6 h-6 rounded-full bg-green-500 items-center justify-center border border-white/20">
                            <ArrowDownToLine size={12} color="#ffffff" />
                          </View>
                        ) : progressVal !== undefined ? (
                          <View className="w-6 h-6 rounded-full bg-black/60 items-center justify-center border border-[var(--primary)]">
                            <Text className="text-[8px] font-black text-[var(--primary)]">
                              {Math.round(progressVal * 100)}%
                            </Text>
                          </View>
                        ) : (
                          <TouchableOpacity
                            onPress={(e) => {
                              e.stopPropagation(); // Prevenir abrir el reproductor
                              onDownloadTrack(track);
                            }}
                            activeOpacity={0.7}
                            className="w-6 h-6 rounded-full bg-black/60 items-center justify-center border border-white/20"
                          >
                            <Download size={12} color="#ffffff" />
                          </TouchableOpacity>
                        )}
                      </View>
                    )}

                    {/* Insignia en imagen */}
                    {isCurrent && (
                      <View className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/80 border border-white/20">
                        <Text className="text-[9px] font-black text-white uppercase">Playing</Text>
                      </View>
                    )}
                  </View>

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
                  <View className="mt-2 pt-2 border-t border-[var(--border)]/40 flex-row justify-between items-center">
                    <Text className="text-[9px] font-bold text-[var(--primary)] uppercase tracking-wider">
                      {isDownloaded ? 'Offline FLAC' : (track.qualityBadge?.split(' ')[0] || 'FLAC')}
                    </Text>
                    <Text className="text-[10px] text-[var(--muted-foreground)]">
                      {Math.floor((track.duration || 0) / 60)}:{((track.duration || 0) % 60).toString().padStart(2, '0')}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

      </ScrollView>
    </View>
  );
};

