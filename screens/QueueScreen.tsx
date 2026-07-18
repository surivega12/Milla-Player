import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Disc,
  MoreVertical,
  Trash2,
} from 'lucide-react-native';
import TrackPlayer, { Event } from 'react-native-track-player';
import { FlashList } from '@shopify/flash-list';
import { Track } from '../components/PlayerBar';
import { TrackOptionsModal } from '../components/TrackOptionsModal';
import { clearQueue, persistPlaybackQueue } from '../services/audio-service';
import { useTheme } from '../context/ThemeContext';

type QueueTrack = Track & { isActive?: boolean; nativeIndex: number };

export interface QueueScreenProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTrack?: (track: Track) => void;
  onOpenLyrics?: (track: Track) => void;
}

export const QueueScreen: React.FC<QueueScreenProps> = ({
  isOpen,
  onClose,
  onOpenLyrics,
}) => {
  const { colors } = useTheme();
  const [nativeQueue, setNativeQueue] = useState<QueueTrack[]>([]);
  const [selectedTrackForOptions, setSelectedTrackForOptions] = useState<QueueTrack | null>(null);
  const [isOptionsModalOpen, setIsOptionsModalOpen] = useState(false);

  const refreshQueue = useCallback(async () => {
    try {
      const [queue, activeIndex] = await Promise.all([
        TrackPlayer.getQueue(),
        TrackPlayer.getActiveTrackIndex(),
      ]);
      const firstVisibleIndex = Math.max(0, activeIndex ?? 0);
      setNativeQueue(queue.map((track, index) => ({
          ...(track as Track),
          id: String(track.id || index),
          url: String(track.url || ''),
          title: String(track.title || 'Cancion sin titulo'),
          artist: String(track.artist || 'Artista desconocido'),
          album: String(track.album || 'Milla Library'),
          artwork: track.artwork || undefined,
          artwork_thumb: track.artwork || undefined,
          duration: Number(track.duration || 0),
          isActive: activeIndex === index,
          nativeIndex: index,
        }))
        .filter((track) => track.nativeIndex >= firstVisibleIndex));
    } catch (error) {
      console.warn('[QueueScreen] No se pudo leer la cola nativa:', error);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void refreshQueue();
    const subscription = TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, refreshQueue);
    return () => subscription.remove();
  }, [isOpen, refreshQueue]);

  const totalDuration = useMemo(
    () => nativeQueue.reduce((total, track) => total + Number(track.duration || 0), 0),
    [nativeQueue]
  );

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remaining = Math.floor(seconds % 60);
    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
      : `${minutes}:${String(remaining).padStart(2, '0')}`;
  };

  const handleRowPress = async (index: number) => {
    try {
      await TrackPlayer.skip(nativeQueue[index].nativeIndex);
      await TrackPlayer.play();
      await persistPlaybackQueue();
      onClose();
    } catch (error) {
      Alert.alert('Cola', 'No se pudo abrir esa pista. Comprueba que el archivo siga disponible.');
    }
  };

  const moveTrack = async (index: number, offset: number) => {
    const destination = index + offset;
    if (destination < 0 || destination >= nativeQueue.length) return;
    if (nativeQueue[index].isActive || nativeQueue[destination].isActive) return;
    try {
      await TrackPlayer.move(nativeQueue[index].nativeIndex, nativeQueue[destination].nativeIndex);
      await persistPlaybackQueue();
      await refreshQueue();
    } catch (error) {
      console.warn('[QueueScreen] No se pudo reordenar la cola:', error);
    }
  };

  const removeTrackAt = async (index: number) => {
    if (nativeQueue[index]?.isActive) {
      Alert.alert('Pista activa', 'Cambia de cancion antes de retirar la pista que esta sonando.');
      return;
    }
    try {
      await TrackPlayer.remove(nativeQueue[index].nativeIndex);
      await persistPlaybackQueue();
      await refreshQueue();
    } catch (error) {
      console.warn('[QueueScreen] No se pudo retirar la pista:', error);
    }
  };

  const playNext = async (track: QueueTrack) => {
    const currentIndex = await TrackPlayer.getActiveTrackIndex();
    if (currentIndex === undefined || currentIndex === null || track.nativeIndex < 0) return;
    const destination = currentIndex + 1;
    if (track.nativeIndex !== destination) await TrackPlayer.move(track.nativeIndex, destination);
    await persistPlaybackQueue();
    await refreshQueue();
  };

  const handleClearQueue = () => {
    Alert.alert(
      'Limpiar proximas canciones',
      'Se conservara la pista que esta sonando y se retirara el resto de la cola.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Limpiar',
          style: 'destructive',
          onPress: async () => {
            await clearQueue();
            await refreshQueue();
          },
        },
      ]
    );
  };

  if (!isOpen) return null;

  return (
    <Modal visible={isOpen} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Cerrar cola"
            style={[styles.iconButton, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <ArrowLeft size={21} color={colors.foreground} />
          </TouchableOpacity>
          <View style={styles.headerText}>
            <Text style={[styles.title, { color: colors.foreground }]}>Cola de reproduccion</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              {nativeQueue.length} canciones, {formatDuration(totalDuration)}
            </Text>
          </View>
          <View style={styles.headerSpacer} />
        </View>

        {nativeQueue.length === 0 ? (
          <View style={styles.emptyState}>
            <Disc size={46} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>La cola esta vacia</Text>
            <Text style={[styles.emptyCopy, { color: colors.mutedForeground }]}>Las proximas canciones apareceran aqui.</Text>
          </View>
        ) : (
          <FlashList
            data={nativeQueue}
            keyExtractor={(item, index) => `${item.id}-${index}`}
            contentContainerStyle={styles.listContent}
            renderItem={({ item, index }) => (
              <TouchableOpacity
                activeOpacity={0.72}
                onPress={() => void handleRowPress(index)}
                style={[
                  styles.row,
                  { borderBottomColor: colors.border },
                  item.isActive && { backgroundColor: colors.secondary },
                ]}
              >
                <View style={styles.orderControls}>
                  <TouchableOpacity
                    disabled={index === 0}
                    onPress={(event) => {
                      event.stopPropagation();
                      void moveTrack(index, -1);
                    }}
                    accessibilityLabel="Mover hacia arriba"
                    style={styles.orderButton}
                  >
                    <ChevronUp size={16} color={index === 0 ? colors.border : colors.mutedForeground} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    disabled={index === nativeQueue.length - 1}
                    onPress={(event) => {
                      event.stopPropagation();
                      void moveTrack(index, 1);
                    }}
                    accessibilityLabel="Mover hacia abajo"
                    style={styles.orderButton}
                  >
                    <ChevronDown size={16} color={index === nativeQueue.length - 1 ? colors.border : colors.mutedForeground} />
                  </TouchableOpacity>
                </View>

                <View style={[styles.artwork, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                  {item.artwork_thumb || item.artwork ? (
                    <Image source={{ uri: item.artwork_thumb || item.artwork }} style={StyleSheet.absoluteFill} />
                  ) : (
                    <Disc size={19} color={colors.mutedForeground} />
                  )}
                </View>

                <View style={styles.trackText}>
                  <Text
                    numberOfLines={1}
                    style={[styles.trackTitle, { color: item.isActive ? colors.primary : colors.foreground }]}
                  >
                    {item.title}
                  </Text>
                  <Text numberOfLines={1} style={[styles.artist, { color: colors.mutedForeground }]}>
                    {item.artist}
                  </Text>
                </View>

                <TouchableOpacity
                  onPress={(event) => {
                    event.stopPropagation();
                    void removeTrackAt(index);
                  }}
                  accessibilityLabel="Retirar de la cola"
                  style={[styles.rowAction, item.isActive && styles.disabledAction]}
                >
                  <Trash2 size={17} color={item.isActive ? colors.border : colors.mutedForeground} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={(event) => {
                    event.stopPropagation();
                    setSelectedTrackForOptions(item);
                    setIsOptionsModalOpen(true);
                  }}
                  accessibilityLabel="Mas opciones"
                  style={styles.rowAction}
                >
                  <MoreVertical size={19} color={colors.mutedForeground} />
                </TouchableOpacity>
              </TouchableOpacity>
            )}
          />
        )}

        {nativeQueue.length > 1 ? (
          <TouchableOpacity
            onPress={handleClearQueue}
            style={[styles.clearButton, { backgroundColor: colors.primary }]}
          >
            <Trash2 size={17} color={colors.primaryForeground} />
            <Text style={[styles.clearText, { color: colors.primaryForeground }]}>Limpiar proximas</Text>
          </TouchableOpacity>
        ) : null}

        <TrackOptionsModal
          visible={isOptionsModalOpen}
          track={selectedTrackForOptions}
          onClose={() => setIsOptionsModalOpen(false)}
          onPlayNext={(track) => {
            const queuedTrack = nativeQueue.find((item) => item.id === track.id);
            if (queuedTrack) void playNext(queuedTrack);
          }}
          onRemoveFromQueue={(track) => {
            const index = nativeQueue.findIndex((item) => item.id === track.id);
            if (index >= 0) void removeTrackAt(index);
          }}
          onGoToLyrics={(track) => onOpenLyrics?.(track)}
        />
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 16 },
  header: { height: 68, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 1 },
  headerText: { flex: 1, alignItems: 'center', paddingHorizontal: 10 },
  title: { fontSize: 18, fontWeight: '800' },
  subtitle: { fontSize: 12, marginTop: 2 },
  headerSpacer: { width: 40 },
  listContent: { paddingBottom: 104 },
  row: { minHeight: 68, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 8 },
  orderControls: { width: 30, height: 48, justifyContent: 'space-between', alignItems: 'center', marginRight: 5 },
  orderButton: { width: 28, height: 22, alignItems: 'center', justifyContent: 'center' },
  artwork: { width: 48, height: 48, borderRadius: 6, borderWidth: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  trackText: { flex: 1, minWidth: 0, paddingHorizontal: 12 },
  trackTitle: { fontSize: 15, fontWeight: '700' },
  artist: { fontSize: 12, marginTop: 3 },
  rowAction: { width: 35, height: 40, alignItems: 'center', justifyContent: 'center' },
  disabledAction: { opacity: 0.45 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  emptyTitle: { marginTop: 16, fontSize: 17, fontWeight: '800' },
  emptyCopy: { marginTop: 5, fontSize: 13, textAlign: 'center' },
  clearButton: { position: 'absolute', right: 20, bottom: 24, minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, borderRadius: 8, elevation: 7 },
  clearText: { fontSize: 12, fontWeight: '900', textTransform: 'uppercase' },
});
