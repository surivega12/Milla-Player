import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
  RefreshControl,
  InteractionManager,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import Animated, { useSharedValue, useAnimatedScrollHandler } from 'react-native-reanimated';
import { AnimatedHeader } from '../components/AnimatedHeader';

const AnimatedFlashList = Animated.createAnimatedComponent(FlashList as any);
import {
  Menu,
  Sparkles,
  Play,
  Disc,
  Music2,
  Filter,
  SortAsc,
  Layers,
  Award,
  MoreVertical,
} from 'lucide-react-native';
import { TrackOptionsModal } from '../components/TrackOptionsModal';
import { Track } from '../components/PlayerBar';
import { getThemeColors } from '../utils/theme-colors';
import { useTheme } from '../context/ThemeContext';
import { getCachedTracks, insertTracks } from '../services/database-service';
import { globalVertexQueueManager } from '../services/queue-service';
import { extractMetadata } from '../services/metadata-service';
import { sanitizeTrackUriForPlayback } from '../services/library-service';

const { width } = Dimensions.get('window');
const COLUMN_COUNT = 1;
const CARD_WIDTH = '100%';

const ARTWORK_FALLBACKS = [
  { background: '#DDF3EF', accent: '#8BC9C0', highlight: '#F7D6A5', text: '#155A56' },
  { background: '#E7E5FF', accent: '#B7B3F2', highlight: '#F6C9DF', text: '#49417D' },
  { background: '#FFE8DE', accent: '#F3B399', highlight: '#F6D98B', text: '#91442B' },
  { background: '#DFECFF', accent: '#9FC3EE', highlight: '#C8E7D6', text: '#24567C' },
];

function getArtworkFallback(track: Track) {
  const label = (track.artist || track.title || 'Milla').trim();
  const seed = Array.from(label).reduce((total, character) => total + character.charCodeAt(0), 0);
  return {
    ...ARTWORK_FALLBACKS[seed % ARTWORK_FALLBACKS.length],
    initial: label.charAt(0).toLocaleUpperCase() || 'M',
  };
}

const TrackArtwork = React.memo(({ track }: { track: Track }) => {
  const imageUrl = track.artwork_thumb || track.artwork;
  const fallback = getArtworkFallback(track);
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [imageUrl]);

  if (imageUrl && !failed) {
    return (
      <Image
        source={{ uri: imageUrl }}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <View style={[styles.artworkFallback, { backgroundColor: fallback.background }]}>
      <View style={[styles.artworkBlob, { backgroundColor: fallback.accent }]} />
      <View style={[styles.artworkHighlight, { backgroundColor: fallback.highlight }]} />
      <Music2 size={19} color={fallback.text} style={styles.artworkIcon} />
      <Text style={[styles.artworkInitial, { color: fallback.text }]}>{fallback.initial}</Text>
    </View>
  );
});

export type SortOption = 'title' | 'artist' | 'album' | 'quality';

export interface LibraryScreenProps {
  onSelectTrack: (track: Track) => void;
  currentTrackId?: string;
  currentTheme?: string;
  tracks?: Track[];
  onOpenSidebar: () => void;
}

export const LibraryScreen: React.FC<LibraryScreenProps> = ({
  onSelectTrack,
  currentTrackId,
  currentTheme,
  tracks: propTracks = [],
  onOpenSidebar,
}) => {
  const { colors: contextColors } = useTheme();
  const colors = contextColors || getThemeColors(currentTheme || 'theme-monochrome');
  const [localTracks, setLocalTracks] = useState<Track[]>(propTracks);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [selectedTrackForOptions, setSelectedTrackForOptions] = useState<Track | null>(null);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [sortBy, setSortBy] = useState<SortOption>('title');
  const [filterLosslessOnly, setFilterLosslessOnly] = useState<boolean>(false);
  const artworkRequestsRef = useRef<Set<string>>(new Set());

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

  // Cargar pistas cacheadas directamente desde SQLite a 120 FPS
  const loadTracksFromDatabase = useCallback(async (showLoading = true) => {
    try {
      if (showLoading) setIsLoading(true);
      const cached = await getCachedTracks();
      if (cached && cached.length > 0) {
        setLocalTracks(cached);
      } else if (propTracks.length > 0) {
        setLocalTracks(propTracks);
      }
    } catch (error) {
      console.error('Error cargando pistas de SQLite en LibraryScreen:', error);
      if (propTracks.length > 0) setLocalTracks(propTracks);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [propTracks]);

  useEffect(() => {
    if (propTracks.length > 0) setLocalTracks(propTracks);
  }, [propTracks]);

  useEffect(() => {
    if (propTracks.length === 0) loadTracksFromDatabase(true);
  }, []);

  // Las carátulas se hidratan con la ruta local ya saneada y se guardan nuevamente en SQLite.
  // Un conjunto de solicitudes evita releer el mismo archivo durante actualizaciones de la lista.
  useEffect(() => {
    let cancelled = false;
    const candidates = localTracks.filter((track) => {
      const hasArtwork = Boolean(track.artwork_thumb || track.artwork);
      return !hasArtwork && Boolean(track.url || track.id) && !artworkRequestsRef.current.has(track.id);
    });

    if (candidates.length === 0) return () => { cancelled = true; };
    candidates.forEach((track) => artworkRequestsRef.current.add(track.id));

    const hydrateArtwork = async () => {
      const BATCH_SIZE = 2;

      for (let index = 0; index < candidates.length && !cancelled; index += BATCH_SIZE) {
        const batch = candidates.slice(index, index + BATCH_SIZE);
        const results = await Promise.all(batch.map(async (track) => {
          try {
            const playableUri = sanitizeTrackUriForPlayback(track.url || track.id);
            const metadata = await extractMetadata(playableUri, track.id);
            if (!metadata.artwork_thumb) return null;
            return {
              ...track,
              url: playableUri,
              artwork: metadata.artwork_thumb,
              artwork_thumb: metadata.artwork_thumb,
            };
          } catch {
            return null;
          }
        }));

        const foundArtwork = results.filter(
          (track): track is NonNullable<typeof track> => track !== null
        );
        if (foundArtwork.length > 0 && !cancelled) {
          const byId = new Map(foundArtwork.map((track) => [track.id, track]));
          setLocalTracks((current) => current.map((track) => byId.get(track.id) || track));
          await insertTracks(foundArtwork).catch((error) => {
            console.warn('No se pudieron persistir las caratulas extraidas:', error);
          });
        }
      }

    };

    const interaction = InteractionManager.runAfterInteractions(hydrateArtwork);
    return () => {
      cancelled = true;
      interaction.cancel();
    };
  }, [localTracks]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadTracksFromDatabase(false);
  };

  // Ordenamiento y filtrado memoizados para no bloquear el hilo de UI
  const sortedTracks = useMemo(() => {
    let filtered = [...localTracks];

    // Filtro rápido para archivos Lossless FLAC / DSD / 24-bit
    if (filterLosslessOnly) {
      filtered = filtered.filter((t) => {
        const badge = (t.qualityBadge || '').toUpperCase();
        return badge.includes('FLAC') || badge.includes('DSD') || badge.includes('24-BIT') || badge.includes('LOSSLESS');
      });
    }

    // Ordenamiento por criterio seleccionado
    filtered.sort((a, b) => {
      if (sortBy === 'title') {
        return (a.title || '').localeCompare(b.title || '', 'es', { sensitivity: 'base' });
      } else if (sortBy === 'artist') {
        return (a.artist || '').localeCompare(b.artist || '', 'es', { sensitivity: 'base' });
      } else if (sortBy === 'album') {
        const albumA = a.album || 'Sin Álbum';
        const albumB = b.album || 'Sin Álbum';
        return albumA.localeCompare(albumB, 'es', { sensitivity: 'base' });
      } else if (sortBy === 'quality') {
        const badgeA = a.qualityBadge || '';
        const badgeB = b.qualityBadge || '';
        return badgeB.localeCompare(badgeA);
      }
      return 0;
    });

    return filtered;
  }, [localTracks, sortBy, filterLosslessOnly]);

  // Manejar clic en una pista: inyectar en cola y reproducir al instante
  const handleCardPress = useCallback(
    (track: Track) => {
      try {
        // Inyectar con máxima prioridad al motor nativo
        globalVertexQueueManager.playNext(track as any);
        onSelectTrack(track);
      } catch (e) {
        console.error('Error al reproducir pista desde LibraryScreen:', e);
        onSelectTrack(track);
      }
    },
    [onSelectTrack]
  );

  const renderFilterBadge = (option: SortOption, label: string, icon: React.ReactNode) => {
    const isActive = sortBy === option;
    return (
      <TouchableOpacity
        onPress={() => setSortBy(option)}
        activeOpacity={0.8}
        className={`flex-row items-center gap-1.5 px-4 py-2 rounded-2xl border transition-all ${
          isActive
            ? 'bg-[var(--primary)] border-[var(--primary)] shadow-lg shadow-[var(--primary)]/40'
            : 'bg-[var(--card)]/60 border-[var(--border)]/50'
        }`}
      >
        {icon}
        <Text
          className={`text-xs font-black tracking-wider uppercase ${
            isActive ? 'text-[var(--primary-foreground)]' : 'text-[var(--muted-foreground)]'
          }`}
        >
          {label}
        </Text>
      </TouchableOpacity>
    );
  };

  const renderTrackCard = useCallback(
    ({ item }: { item: Track }) => {
      const isCurrent = item.id === currentTrackId;
      const isLossless =
        (item.qualityBadge || '').toUpperCase().includes('FLAC') ||
        (item.qualityBadge || '').toUpperCase().includes('DSD') ||
        (item.qualityBadge || '').toUpperCase().includes('24-BIT');

      // Si existe miniatura ultraligera en SQLite, usarla; si no, usar artwork o fallback
      return (
        <TouchableOpacity
          onPress={() => handleCardPress(item)}
          activeOpacity={0.8}
          style={{ width: '100%', marginBottom: 8 }}
          className={`flex-row items-center p-2 rounded-xl transition-all ${
            isCurrent
              ? 'bg-[var(--primary)]/10'
              : ''
          }`}
        >
          {/* Carátula (Extremo Izquierdo) */}
          <View style={{ width: 53, height: 53 }} className="rounded-md overflow-hidden bg-neutral-900 border border-white/5 mr-3 relative">
            <TrackArtwork track={item} />
            {/* Indicador de Reproducción Actual */}
            {isCurrent && (
              <View className="absolute inset-0 bg-black/50 items-center justify-center">
                <Play size={16} color={colors.primaryForeground} fill={colors.primaryForeground} style={{ marginLeft: 2 }} />
              </View>
            )}
          </View>

          {/* Información de la pista (Centro) */}
          <View style={{ flex: 1 }} className="justify-center">
            <Text
              numberOfLines={1}
              className={`text-[15px] font-medium tracking-tight flex-1 ${
                isCurrent ? 'text-[var(--primary)]' : 'text-white'
              }`}
            >
              {item.title || 'Canción Sin Título'}
            </Text>
            <Text
              numberOfLines={1}
              className="text-sm text-neutral-400 mt-0.5"
            >
              {(item.artist === 'Local Library' || item.artist === 'Unknown Artist') ? 'Unknown Artist' : item.artist}
            </Text>
          </View>

          {/* Opciones (Extremo Derecho) */}
          <TouchableOpacity
            onPress={() => setSelectedTrackForOptions(item)}
            hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
            className="p-2 ml-2"
          >
            <MoreVertical size={20} color={colors.mutedForeground} />
          </TouchableOpacity>
        </TouchableOpacity>
      );
    },
    [currentTrackId, colors, handleCardPress]
  );

  const renderListHeader = () => (
    <View className="mb-4 mt-[100px] px-4">
      {/* Menú de Filtros por Orden: Solo Título y Conteo de Pistas */}
      <View className="flex-row items-center justify-between mb-2">
        <View className="flex-row items-center gap-2">
          {renderFilterBadge('title', 'Título', <SortAsc size={14} color={sortBy === 'title' ? colors.primaryForeground : colors.mutedForeground} />)}
        </View>
        <Text style={{ color: colors.mutedForeground }} className="text-xs font-extrabold">
          {sortedTracks.length} pistas
        </Text>
      </View>
    </View>
  );

  return (
    <View className="flex-1 bg-[var(--background)]" style={{ backgroundColor: colors.background }}>
      <AnimatedHeader
        title="Biblioteca"
        headerTranslationY={headerTranslationY}
        onOpenSidebar={onOpenSidebar}
      />

      {/* Contenido Principal: Grid con FlashList @shopify/flash-list */}
      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={{ color: colors.mutedForeground }} className="text-xs font-bold text-[var(--muted-foreground)] mt-3 tracking-wide">
            Cargando catálogo audiófilo desde SQLite...
          </Text>
        </View>
      ) : sortedTracks.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8 text-center">
          <Layers size={48} color={colors.mutedForeground} style={{ opacity: 0.5, marginBottom: 12 }} />
          <Text style={{ color: colors.foreground }} className="text-lg font-black text-[var(--foreground)] text-center">
            No hay canciones en la vista actual
          </Text>
          <Text style={{ color: colors.mutedForeground }} className="text-xs text-[var(--muted-foreground)] text-center mt-2 leading-relaxed">
            {filterLosslessOnly
              ? 'No se encontraron pistas etiquetadas explícitamente como FLAC / DSD en la base de datos local. Desactiva el filtro o escanea de nuevo.'
              : 'Tu biblioteca local de SQLite está vacía en este momento. Dirígete a Inicio para escanear tus archivos FLAC o añadir pistas.'}
          </Text>
        </View>
      ) : (
        <View className="flex-1 px-4">
          <AnimatedFlashList
            data={sortedTracks}
            renderItem={renderTrackCard}
            ListHeaderComponent={renderListHeader}
            onScroll={scrollHandler}
            scrollEventThrottle={16}
            {...({ estimatedItemSize: 240 } as any)}
            numColumns={COLUMN_COUNT}
            contentContainerStyle={{ paddingBottom: 130 }}
            showsVerticalScrollIndicator={false}
            keyExtractor={(item: any) => item.id}
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={handleRefresh}
                tintColor={colors.primary}
              />
            }
          />
        </View>
      )}

      {/* Modal de Opciones */}
      <TrackOptionsModal
        visible={!!selectedTrackForOptions}
        track={selectedTrackForOptions}
        onClose={() => setSelectedTrackForOptions(null)}
        onPlayNext={(track) => globalVertexQueueManager.playNext(track as any)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  artworkFallback: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  artworkBlob: {
    position: 'absolute',
    width: 54,
    height: 54,
    borderRadius: 27,
    top: -18,
    right: -16,
    opacity: 0.8,
  },
  artworkHighlight: {
    position: 'absolute',
    width: 42,
    height: 42,
    borderRadius: 21,
    bottom: -16,
    left: -12,
    opacity: 0.75,
  },
  artworkInitial: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 0,
  },
  artworkIcon: {
    position: 'absolute',
    right: 5,
    bottom: 5,
    opacity: 0.65,
  },
});
