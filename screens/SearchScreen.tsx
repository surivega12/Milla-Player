import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  StyleSheet,
  ActivityIndicator,
  Keyboard,
  ScrollView,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import {
  Search,
  X,
  Menu,
  Sparkles,
  Music2,
  Play,
  Award,
  Clock,
  ChevronRight,
  Flame,
} from 'lucide-react-native';
import { Track } from '../components/PlayerBar';
import { getThemeColors } from '../utils/theme-colors';
import { searchCachedTracks, getCachedTracks } from '../services/database-service';
import { globalVertexQueueManager } from '../services/queue-service';

export interface SearchScreenProps {
  onSelectTrack: (track: Track) => void;
  currentTrackId?: string;
  currentTheme: string;
  onOpenSidebar: () => void;
}

const QUICK_TAGS = [
  'FLAC 24-bit',
  'Lossless Hi-Res',
  'DSD Direct',
  'MP3 320kbps',
  'WAV PCM',
];

export const SearchScreen: React.FC<SearchScreenProps> = ({
  onSelectTrack,
  currentTrackId,
  currentTheme,
  onOpenSidebar,
}) => {
  const colors = getThemeColors(currentTheme);
  const [query, setQuery] = useState<string>('');
  const [results, setResults] = useState<Track[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const inputRef = useRef<TextInput>(null);

  // Debounce de 300ms para consultas locales en SQLite
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const timeoutId = setTimeout(async () => {
      try {
        const localMatches = await searchCachedTracks(query);
        setResults(localMatches);
      } catch (err) {
        console.error('Error en búsqueda instantánea SQLite:', err);
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [query]);

  // Si el usuario toca una sugerencia rápida o historial
  const handleTagPress = useCallback((tagText: string) => {
    setQuery(tagText);
    Keyboard.dismiss();
  }, []);

  const handleClear = () => {
    setQuery('');
    setResults([]);
    inputRef.current?.focus();
  };

  const formatDuration = (sec?: number) => {
    if (!sec || isNaN(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const handleTrackPress = useCallback(
    (track: Track) => {
      // Guardar en historial de búsquedas si el texto no está vacío
      if (query.trim() && !recentSearches.includes(query.trim())) {
        setRecentSearches((prev) => [query.trim(), ...prev.slice(0, 7)]);
      }
      Keyboard.dismiss();
      globalVertexQueueManager.playNext(track as any);
      onSelectTrack(track);
    },
    [query, recentSearches, onSelectTrack]
  );

  const renderTrackItem = useCallback(
    ({ item }: { item: Track }) => {
      const isCurrent = item.id === currentTrackId;
      const isLossless =
        (item.qualityBadge || '').toUpperCase().includes('FLAC') ||
        (item.qualityBadge || '').toUpperCase().includes('DSD') ||
        (item.qualityBadge || '').toUpperCase().includes('24-BIT');
      const imageUrl = item.artwork_thumb || item.artwork;

      return (
        <TouchableOpacity
          onPress={() => handleTrackPress(item)}
          activeOpacity={0.8}
          className={`flex-row items-center justify-between p-3.5 mb-2.5 rounded-2xl border transition-all ${
            isCurrent
              ? 'bg-[var(--primary)]/15 border-[var(--primary)] shadow-lg shadow-[var(--primary)]/20'
              : 'bg-[var(--card)]/70 border-[var(--border)]/50'
          }`}
        >
          {/* Lado izquierdo: miniatura e info */}
          <View className="flex-row items-center gap-3.5 flex-1 mr-3">
            <View className="w-13 h-13 rounded-xl overflow-hidden bg-neutral-900 relative border border-white/10 items-center justify-center">
              {imageUrl ? (
                <Image
                  source={{ uri: imageUrl }}
                  style={StyleSheet.absoluteFill}
                  resizeMode="cover"
                />
              ) : (
                <Music2 size={22} color={colors.mutedForeground} />
              )}
              {isCurrent && (
                <View className="absolute inset-0 bg-black/60 items-center justify-center">
                  <Play size={16} color={colors.primaryForeground} fill={colors.primaryForeground} style={{ marginLeft: 2 }} />
                </View>
              )}
            </View>

            <View className="flex-1">
              <View className="flex-row items-center gap-1.5">
                <Text
                  numberOfLines={1}
                  className={`text-sm font-black tracking-tight ${
                    isCurrent ? 'text-[var(--primary)]' : 'text-[var(--foreground)]'
                  }`}
                >
                  {item.title || 'Pista Sin Título'}
                </Text>
              </View>

              <Text numberOfLines={1} className="text-xs text-[var(--muted-foreground)] font-semibold mt-0.5">
                {item.artist || 'Artista Desconocido'} {item.album ? `• ${item.album}` : ''}
              </Text>

              {/* Badges de calidad y duración */}
              <View className="flex-row items-center gap-2 mt-1.5">
                {isLossless && (
                  <View className="bg-indigo-500/15 border border-indigo-500/40 px-1.5 py-0.5 rounded flex-row items-center gap-1">
                    <Award size={9} color="#818cf8" />
                    <Text className="text-[8px] font-black text-indigo-300 uppercase tracking-tighter">
                      FLAC
                    </Text>
                  </View>
                )}
                <View className="flex-row items-center gap-1">
                  <Clock size={10} color={colors.mutedForeground} />
                  <Text className="text-[10px] text-[var(--muted-foreground)] font-bold">
                    {formatDuration(item.duration)}
                  </Text>
                </View>
              </View>
            </View>
          </View>

          {/* Lado derecho: Acción rápida */}
          <View className="w-8 h-8 rounded-full bg-[var(--secondary)]/50 items-center justify-center border border-[var(--border)]/40">
            <ChevronRight size={16} color={colors.mutedForeground} />
          </View>
        </TouchableOpacity>
      );
    },
    [currentTrackId, colors, handleTrackPress]
  );

  return (
    <View className="flex-1 bg-[var(--background)]">
      {/* Cabecera y Barra de Búsqueda Premium */}
      <View className="pt-12 pb-4 px-4 border-b border-[var(--border)]/40 bg-[var(--card)]/40 relative z-10">
        <View className="flex-row items-center justify-between mb-4">
          <View className="flex-row items-center gap-3">
            <TouchableOpacity
              onPress={onOpenSidebar}
              className="w-11 h-11 rounded-2xl bg-[var(--secondary)]/50 items-center justify-center border border-[var(--border)]/60"
            >
              <Menu size={22} color={colors.foreground} />
            </TouchableOpacity>
            <View>
              <View className="flex-row items-center gap-1.5">
                <Sparkles size={14} color={colors.primary} />
                <Text className="text-[10px] font-black uppercase tracking-widest text-[var(--primary)]">
                  Instant SQLite Engine • 0ms Latency
                </Text>
              </View>
              <Text className="text-2xl font-black text-[var(--foreground)] tracking-tight">
                Buscador Offline
              </Text>
            </View>
          </View>
        </View>

        {/* Input de Búsqueda Estilo Apple Music / Premium Glass */}
        <View className="flex-row items-center bg-[var(--secondary)]/60 rounded-2xl px-4 py-3 border border-[var(--border)]/60 shadow-inner">
          <Search size={18} color={colors.mutedForeground} style={{ marginRight: 10 }} />
          <TextInput
            ref={inputRef}
            value={query}
            onChangeText={setQuery}
            placeholder="Buscar por canción, artista o álbum en SQLite..."
            placeholderTextColor={colors.mutedForeground}
            className="flex-1 text-sm font-bold text-[var(--foreground)] p-0"
            autoCorrect={false}
            returnKeyType="search"
          />
          {isSearching && (
            <ActivityIndicator size="small" color={colors.primary} style={{ marginRight: 8 }} />
          )}
          {query.length > 0 && (
            <TouchableOpacity onPress={handleClear} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <View className="w-5 h-5 rounded-full bg-[var(--muted-foreground)]/30 items-center justify-center">
                <X size={12} color={colors.foreground} />
              </View>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Contenido de Resultados o Vista Inicial */}
      {query.trim().length === 0 ? (
        <ScrollView className="flex-1 px-4 pt-5" showsVerticalScrollIndicator={false}>
          {/* Sección de Etiquetas Rápidas / Géneros y Calidad */}
          <View className="mb-6">
            <View className="flex-row items-center gap-2 mb-3">
              <Flame size={16} color={colors.primary} />
              <Text className="text-xs font-black uppercase tracking-widest text-[var(--foreground)]">
                Etiquetas y Calidad Hi-Fi
              </Text>
            </View>
            <View className="flex-row flex-wrap gap-2">
              {QUICK_TAGS.map((tag, i) => (
                <TouchableOpacity
                  key={`tag-${i}`}
                  onPress={() => handleTagPress(tag)}
                  activeOpacity={0.75}
                  className="px-3.5 py-2 rounded-xl bg-[var(--card)]/80 border border-[var(--border)]/50 shadow-sm"
                >
                  <Text className="text-xs font-bold text-[var(--foreground)]">{tag}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Búsquedas Recientes */}
          {recentSearches.length > 0 && (
            <View className="mb-8">
              <Text className="text-xs font-black uppercase tracking-widest text-[var(--muted-foreground)] mb-3">
                Búsquedas Recientes
              </Text>
              {recentSearches.map((item, index) => (
                <TouchableOpacity
                  key={`recent-${index}`}
                  onPress={() => handleTagPress(item)}
                  activeOpacity={0.8}
                  className="flex-row items-center justify-between py-3 border-b border-[var(--border)]/30"
                >
                  <View className="flex-row items-center gap-3">
                    <Clock size={15} color={colors.mutedForeground} />
                    <Text className="text-sm font-semibold text-[var(--foreground)]">{item}</Text>
                  </View>
                  <TouchableOpacity
                    onPress={(event) => {
                      event.stopPropagation();
                      setRecentSearches(recentSearches.filter((_, idx) => idx !== index));
                    }}
                  >
                    <X size={14} color={colors.mutedForeground} />
                  </TouchableOpacity>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </ScrollView>
      ) : isSearching && results.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={colors.primary} />
          <Text className="text-xs font-bold text-[var(--muted-foreground)] mt-3">
            Consultando índices de SQLite en 0ms...
          </Text>
        </View>
      ) : results.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8 text-center">
          <Search size={48} color={colors.mutedForeground} style={{ opacity: 0.4, marginBottom: 12 }} />
          <Text className="text-lg font-black text-[var(--foreground)] text-center">
            No encontramos "{query}"
          </Text>
          <Text className="text-xs text-[var(--muted-foreground)] text-center mt-2 leading-relaxed">
            Verifica la ortografía o asegúrate de que el archivo FLAC / MP3 haya sido escaneado e indexado previamente en tu base de datos local SQLite.
          </Text>
        </View>
      ) : (
        <View className="flex-1 pt-3 px-4">
          <Text className="text-xs font-black uppercase tracking-widest text-[var(--muted-foreground)] mb-3 px-1">
            Resultados Instantáneos ({results.length})
          </Text>
          <FlashList<Track>
            data={results}
            renderItem={renderTrackItem}
            {...({ estimatedItemSize: 85 } as any)}
            contentContainerStyle={{ paddingBottom: 130 }}
            showsVerticalScrollIndicator={false}
            keyExtractor={(item) => item.id}
          />
        </View>
      )}
    </View>
  );
};
