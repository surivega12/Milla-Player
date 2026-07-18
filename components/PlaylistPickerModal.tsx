import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Check, Disc, Heart, ListMusic, Plus, X } from 'lucide-react-native';
import { FlashList } from '@shopify/flash-list';
import { Track } from './PlayerBar';
import {
  addTrackToPlaylist,
  createPlaylist,
  getPlaylists,
  PlaylistSummary,
} from '../services/database-service';
import { useTheme } from '../context/ThemeContext';

interface PlaylistPickerModalProps {
  visible: boolean;
  track: Track | null;
  onClose: () => void;
  onAdded?: (playlist: PlaylistSummary) => void;
}

export const PlaylistPickerModal: React.FC<PlaylistPickerModalProps> = ({
  visible,
  track,
  onClose,
  onAdded,
}) => {
  const { colors } = useTheme();
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);

  const loadPlaylists = useCallback(async () => {
    setIsLoading(true);
    try {
      setPlaylists(await getPlaylists());
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      setIsCreating(false);
      setName('');
      void loadPlaylists();
    }
  }, [visible, loadPlaylists]);

  const addTo = async (playlist: PlaylistSummary) => {
    if (!track) return;
    setSavingId(playlist.id);
    try {
      await addTrackToPlaylist(playlist.id, track.id);
      onAdded?.({ ...playlist, track_count: playlist.track_count + 1 });
      onClose();
    } catch (error) {
      Alert.alert('Playlist', 'No se pudo agregar la cancion a esa playlist.');
    } finally {
      setSavingId(null);
    }
  };

  const createAndAdd = async () => {
    const cleanName = name.trim();
    if (!cleanName || !track) return;
    setSavingId('new');
    try {
      const playlist = await createPlaylist(cleanName);
      await addTrackToPlaylist(playlist.id, track.id);
      onAdded?.({ ...playlist, track_count: 1 });
      onClose();
    } catch (error: any) {
      Alert.alert('Nueva playlist', error?.message || 'No se pudo crear la playlist.');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <Modal visible={visible && Boolean(track)} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <SafeAreaView edges={['bottom']} style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={[styles.title, { color: colors.foreground }]}>Agregar a playlist</Text>
              <Text numberOfLines={1} style={[styles.subtitle, { color: colors.mutedForeground }]}>
                {track?.title}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} accessibilityLabel="Cerrar" style={styles.iconButton}>
              <X size={21} color={colors.foreground} />
            </TouchableOpacity>
          </View>

          {isCreating ? (
            <View style={[styles.createPanel, { borderColor: colors.border }]}>
              <TextInput
                autoFocus
                value={name}
                onChangeText={setName}
                placeholder="Nombre de la playlist"
                placeholderTextColor={colors.mutedForeground}
                maxLength={80}
                returnKeyType="done"
                onSubmitEditing={() => void createAndAdd()}
                style={[
                  styles.input,
                  { color: colors.foreground, backgroundColor: colors.input, borderColor: colors.border },
                ]}
              />
              <View style={styles.createActions}>
                <TouchableOpacity onPress={() => setIsCreating(false)} style={styles.textButton}>
                  <Text style={[styles.cancelText, { color: colors.mutedForeground }]}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => void createAndAdd()}
                  disabled={!name.trim() || savingId === 'new'}
                  style={[
                    styles.createButton,
                    { backgroundColor: colors.primary, opacity: !name.trim() ? 0.45 : 1 },
                  ]}
                >
                  {savingId === 'new' ? (
                    <ActivityIndicator size="small" color={colors.primaryForeground} />
                  ) : (
                    <Check size={17} color={colors.primaryForeground} />
                  )}
                  <Text style={[styles.createButtonText, { color: colors.primaryForeground }]}>Crear y agregar</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity
              onPress={() => setIsCreating(true)}
              style={[styles.newRow, { borderColor: colors.border }]}
            >
              <View style={[styles.playlistIcon, { backgroundColor: colors.primary }]}>
                <Plus size={22} color={colors.primaryForeground} />
              </View>
              <Text style={[styles.newText, { color: colors.foreground }]}>Nueva playlist</Text>
            </TouchableOpacity>
          )}

          {isLoading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : (
            <FlashList
              data={playlists}
              keyExtractor={(item) => item.id}
              style={styles.list}
              renderItem={({ item }) => (
                <TouchableOpacity
                  onPress={() => void addTo(item)}
                  disabled={savingId !== null}
                  style={[styles.playlistRow, { borderBottomColor: colors.border }]}
                >
                  <View style={[styles.cover, { backgroundColor: colors.muted }]}>
                    {item.artwork ? (
                      <Image source={{ uri: item.artwork }} style={StyleSheet.absoluteFill} />
                    ) : item.is_system ? (
                      <Heart size={21} color={colors.primary} />
                    ) : (
                      <Disc size={21} color={colors.mutedForeground} />
                    )}
                  </View>
                  <View style={styles.playlistCopy}>
                    <Text numberOfLines={1} style={[styles.playlistName, { color: colors.foreground }]}>
                      {item.name}
                    </Text>
                    <Text style={[styles.count, { color: colors.mutedForeground }]}>
                      {item.track_count} canciones
                    </Text>
                  </View>
                  {savingId === item.id ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <ListMusic size={19} color={colors.mutedForeground} />
                  )}
                </TouchableOpacity>
              )}
            />
          )}
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.58)' },
  sheet: { height: '72%', borderTopWidth: 1, borderTopLeftRadius: 8, borderTopRightRadius: 8, paddingHorizontal: 18 },
  handle: { width: 38, height: 4, borderRadius: 2, backgroundColor: 'rgba(150,150,150,0.45)', alignSelf: 'center', marginTop: 9 },
  header: { height: 72, flexDirection: 'row', alignItems: 'center' },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { fontSize: 19, fontWeight: '800' },
  subtitle: { fontSize: 12, marginTop: 3 },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  newRow: { height: 64, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  playlistIcon: { width: 44, height: 44, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  newText: { marginLeft: 13, fontSize: 15, fontWeight: '700' },
  createPanel: { paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth },
  input: { height: 46, borderRadius: 6, borderWidth: 1, paddingHorizontal: 12, fontSize: 15 },
  createActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 10, gap: 8 },
  textButton: { minHeight: 40, paddingHorizontal: 12, justifyContent: 'center' },
  cancelText: { fontSize: 13, fontWeight: '700' },
  createButton: { minHeight: 40, borderRadius: 6, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 7 },
  createButtonText: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { flex: 1 },
  playlistRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  cover: { width: 44, height: 44, borderRadius: 6, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  playlistCopy: { flex: 1, minWidth: 0, paddingHorizontal: 13 },
  playlistName: { fontSize: 15, fontWeight: '700' },
  count: { fontSize: 12, marginTop: 2 },
});
