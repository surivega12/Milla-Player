import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import {
  ChevronLeft,
  Disc,
  Heart,
  ListMusic,
  Menu,
  MoreVertical,
  Play,
  Plus,
  Trash2,
  X,
} from 'lucide-react-native';
import { Track } from '../components/PlayerBar';
import { TrackOptionsModal } from '../components/TrackOptionsModal';
import {
  createPlaylist,
  deletePlaylist,
  getPlaylistTracks,
  getPlaylists,
  PlaylistSummary,
} from '../services/database-service';
import { playPlaylist } from '../services/audio-service';
import { useTheme } from '../context/ThemeContext';

interface PlaylistsScreenProps {
  onOpenSidebar: () => void;
  currentTrackId?: string;
}

export const PlaylistsScreen: React.FC<PlaylistsScreenProps> = ({
  onOpenSidebar,
  currentTrackId,
}) => {
  const { colors } = useTheme();
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const [selected, setSelected] = useState<PlaylistSummary | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);

  const refreshPlaylists = useCallback(async () => {
    setIsLoading(true);
    try {
      setPlaylists(await getPlaylists());
    } finally {
      setIsLoading(false);
    }
  }, []);

  const openPlaylist = useCallback(async (playlist: PlaylistSummary) => {
    setSelected(playlist);
    setIsLoading(true);
    try {
      setTracks(await getPlaylistTracks(playlist.id));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshPlaylists();
  }, [refreshPlaylists]);

  const createNewPlaylist = async () => {
    if (!newName.trim()) return;
    try {
      const playlist = await createPlaylist(newName);
      setCreateOpen(false);
      setNewName('');
      await refreshPlaylists();
      await openPlaylist(playlist);
    } catch (error: any) {
      Alert.alert('Nueva playlist', error?.message || 'No se pudo crear la playlist.');
    }
  };

  const confirmDelete = (playlist: PlaylistSummary) => {
    Alert.alert('Eliminar playlist', `Se eliminara "${playlist.name}", pero no sus archivos de audio.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          await deletePlaylist(playlist.id);
          setSelected(null);
          setTracks([]);
          await refreshPlaylists();
        },
      },
    ]);
  };

  const startPlaylist = async (index: number = 0) => {
    if (tracks.length === 0) return;
    try {
      await playPlaylist(tracks, index);
    } catch (error) {
      Alert.alert('Playlist', 'No se pudo reproducir esta lista.');
    }
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '--:--';
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[styles.toolbar, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={selected ? () => setSelected(null) : onOpenSidebar} style={styles.toolbarButton}>
          {selected ? <ChevronLeft size={22} color={colors.foreground} /> : <Menu size={22} color={colors.foreground} />}
        </TouchableOpacity>
        <View style={styles.toolbarCopy}>
          <Text numberOfLines={1} style={[styles.screenTitle, { color: colors.foreground }]}>
            {selected?.name || 'Playlists'}
          </Text>
          <Text style={[styles.screenSubtitle, { color: colors.mutedForeground }]}>
            {selected ? `${tracks.length} canciones` : `${playlists.length} listas`}
          </Text>
        </View>
        {selected && !selected.is_system ? (
          <TouchableOpacity onPress={() => confirmDelete(selected)} style={styles.toolbarButton}>
            <Trash2 size={20} color={colors.mutedForeground} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={() => setCreateOpen(true)} style={styles.toolbarButton}>
            <Plus size={22} color={colors.foreground} />
          </TouchableOpacity>
        )}
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : selected ? (
        <FlashList
          data={tracks}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={(
            <View style={styles.detailHeader}>
              <View style={[styles.heroCover, { backgroundColor: colors.card }]}>
                {selected.artwork ? (
                  <Image source={{ uri: selected.artwork }} style={StyleSheet.absoluteFill} />
                ) : selected.is_system ? (
                  <Heart size={54} color={colors.primary} />
                ) : (
                  <ListMusic size={54} color={colors.mutedForeground} />
                )}
              </View>
              <Text numberOfLines={2} style={[styles.detailTitle, { color: colors.foreground }]}>{selected.name}</Text>
              <Text style={[styles.detailMeta, { color: colors.mutedForeground }]}>{tracks.length} canciones</Text>
              <TouchableOpacity
                onPress={() => void startPlaylist(0)}
                disabled={tracks.length === 0}
                style={[styles.playButton, { backgroundColor: colors.primary, opacity: tracks.length ? 1 : 0.45 }]}
              >
                <Play size={18} color={colors.primaryForeground} fill={colors.primaryForeground} />
                <Text style={[styles.playText, { color: colors.primaryForeground }]}>Reproducir</Text>
              </TouchableOpacity>
            </View>
          )}
          ListEmptyComponent={(
            <View style={styles.empty}>
              <Disc size={38} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Playlist vacia</Text>
              <Text style={[styles.emptyCopy, { color: colors.mutedForeground }]}>Agrega canciones desde el menu de tres puntos.</Text>
            </View>
          )}
          contentContainerStyle={styles.trackListContent}
          renderItem={({ item, index }) => {
            const artwork = item.artwork_thumb || item.artwork;
            const isActive = item.id === currentTrackId;
            return (
              <TouchableOpacity
                onPress={() => void startPlaylist(index)}
                style={[styles.trackRow, { borderBottomColor: colors.border }, isActive && { backgroundColor: colors.secondary }]}
              >
                <View style={[styles.rowArtwork, { backgroundColor: colors.muted }]}>
                  {artwork ? <Image source={{ uri: artwork }} style={StyleSheet.absoluteFill} /> : <Disc size={17} color={colors.mutedForeground} />}
                </View>
                <View style={styles.rowCopy}>
                  <Text numberOfLines={1} style={[styles.rowTitle, { color: isActive ? colors.primary : colors.foreground }]}>{item.title}</Text>
                  <Text numberOfLines={1} style={[styles.rowArtist, { color: colors.mutedForeground }]}>{item.artist}</Text>
                </View>
                <Text style={[styles.duration, { color: colors.mutedForeground }]}>{formatDuration(item.duration)}</Text>
                <TouchableOpacity
                  onPress={(event) => {
                    event.stopPropagation();
                    setSelectedTrack(item);
                  }}
                  style={styles.rowMenu}
                >
                  <MoreVertical size={19} color={colors.mutedForeground} />
                </TouchableOpacity>
              </TouchableOpacity>
            );
          }}
        />
      ) : (
        <FlashList
          data={playlists}
          numColumns={2}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.gridContent}
          renderItem={({ item }) => (
            <TouchableOpacity onPress={() => void openPlaylist(item)} style={styles.gridItem}>
              <View style={[styles.gridCover, { backgroundColor: colors.card, borderColor: colors.border }]}>
                {item.artwork ? (
                  <Image source={{ uri: item.artwork }} style={StyleSheet.absoluteFill} />
                ) : item.is_system ? (
                  <Heart size={40} color={colors.primary} />
                ) : (
                  <ListMusic size={40} color={colors.mutedForeground} />
                )}
              </View>
              <Text numberOfLines={1} style={[styles.gridTitle, { color: colors.foreground }]}>{item.name}</Text>
              <Text style={[styles.gridMeta, { color: colors.mutedForeground }]}>{item.track_count} canciones</Text>
            </TouchableOpacity>
          )}
        />
      )}

      <Modal visible={createOpen} transparent animationType="fade" onRequestClose={() => setCreateOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.nameDialog, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.dialogHeader}>
              <Text style={[styles.dialogTitle, { color: colors.foreground }]}>Nueva playlist</Text>
              <TouchableOpacity onPress={() => setCreateOpen(false)} style={styles.toolbarButton}>
                <X size={20} color={colors.foreground} />
              </TouchableOpacity>
            </View>
            <TextInput
              autoFocus
              value={newName}
              onChangeText={setNewName}
              placeholder="Nombre"
              placeholderTextColor={colors.mutedForeground}
              maxLength={80}
              onSubmitEditing={() => void createNewPlaylist()}
              style={[styles.nameInput, { color: colors.foreground, backgroundColor: colors.input, borderColor: colors.border }]}
            />
            <TouchableOpacity
              onPress={() => void createNewPlaylist()}
              disabled={!newName.trim()}
              style={[styles.dialogCreate, { backgroundColor: colors.primary, opacity: newName.trim() ? 1 : 0.45 }]}
            >
              <Text style={[styles.dialogCreateText, { color: colors.primaryForeground }]}>Crear</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <TrackOptionsModal
        visible={Boolean(selectedTrack)}
        track={selectedTrack}
        onClose={() => {
          setSelectedTrack(null);
          if (selected) void openPlaylist(selected);
        }}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  toolbar: { height: 66, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  toolbarButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  toolbarCopy: { flex: 1, alignItems: 'center', minWidth: 0 },
  screenTitle: { fontSize: 18, fontWeight: '800' },
  screenSubtitle: { fontSize: 11, marginTop: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  gridContent: { paddingHorizontal: 10, paddingTop: 14, paddingBottom: 120 },
  gridItem: { flex: 1, paddingHorizontal: 6, marginBottom: 18 },
  gridCover: { width: '100%', aspectRatio: 1, borderRadius: 7, borderWidth: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  gridTitle: { fontSize: 15, fontWeight: '700', marginTop: 8 },
  gridMeta: { fontSize: 12, marginTop: 2 },
  detailHeader: { alignItems: 'center', paddingTop: 22, paddingBottom: 18 },
  heroCover: { width: 176, height: 176, borderRadius: 8, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  detailTitle: { fontSize: 24, fontWeight: '800', marginTop: 14, paddingHorizontal: 20, textAlign: 'center' },
  detailMeta: { fontSize: 12, marginTop: 5 },
  playButton: { height: 44, minWidth: 142, borderRadius: 7, marginTop: 14, paddingHorizontal: 17, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  playText: { fontSize: 13, fontWeight: '800', textTransform: 'uppercase' },
  trackListContent: { paddingBottom: 120 },
  trackRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  rowArtwork: { width: 42, height: 42, borderRadius: 5, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  rowCopy: { flex: 1, minWidth: 0, paddingHorizontal: 11 },
  rowTitle: { fontSize: 14, fontWeight: '700' },
  rowArtist: { fontSize: 11, marginTop: 3 },
  duration: { width: 40, textAlign: 'right', fontSize: 11 },
  rowMenu: { width: 38, height: 42, alignItems: 'center', justifyContent: 'center' },
  empty: { minHeight: 220, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  emptyTitle: { fontSize: 16, fontWeight: '800', marginTop: 12 },
  emptyCopy: { fontSize: 12, marginTop: 4, textAlign: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.62)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  nameDialog: { width: '100%', maxWidth: 380, borderRadius: 8, borderWidth: 1, padding: 18 },
  dialogHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  dialogTitle: { flex: 1, fontSize: 19, fontWeight: '800' },
  nameInput: { height: 46, borderRadius: 6, borderWidth: 1, paddingHorizontal: 12, fontSize: 15 },
  dialogCreate: { height: 43, borderRadius: 6, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  dialogCreateText: { fontSize: 13, fontWeight: '800', textTransform: 'uppercase' },
});
