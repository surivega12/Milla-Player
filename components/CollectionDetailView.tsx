import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import {
  ChevronLeft,
  Disc,
  ExternalLink,
  MoreVertical,
  Play,
  User,
} from 'lucide-react-native';
import { Track } from './PlayerBar';
import { TrackOptionsModal } from './TrackOptionsModal';
import { playPlaylist } from '../services/audio-service';
import { ArtistProfile, getArtistProfile } from '../services/musicbrainz-service';
import { useTheme } from '../context/ThemeContext';

interface CollectionDetailViewProps {
  kind: 'artist' | 'album';
  title: string;
  subtitle?: string;
  artwork?: string;
  tracks: Track[];
  currentTrackId?: string;
  onBack: () => void;
}

export const CollectionDetailView: React.FC<CollectionDetailViewProps> = ({
  kind,
  title,
  subtitle,
  artwork,
  tracks,
  currentTrackId,
  onBack,
}) => {
  const { colors } = useTheme();
  const [profile, setProfile] = useState<ArtistProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(kind === 'artist');
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => subscription.remove();
  }, [onBack]);

  useEffect(() => {
    let cancelled = false;
    if (kind !== 'artist') {
      setProfile(null);
      setProfileLoading(false);
      return;
    }
    setProfileLoading(true);
    getArtistProfile(title).then((result) => {
      if (!cancelled) {
        setProfile(result);
        setProfileLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [kind, title]);

  const totalDuration = useMemo(
    () => tracks.reduce((total, track) => total + Number(track.duration || 0), 0),
    [tracks]
  );
  const qualityBadges = useMemo(
    () => Array.from(new Set(tracks.map((track) => track.qualityBadge).filter(Boolean))).slice(0, 3),
    [tracks]
  );

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
  };

  const playFrom = async (index: number) => {
    if (!tracks.length) return;
    await playPlaylist(tracks, index).catch((error) => {
      console.warn('[CollectionDetail] No se pudo iniciar la coleccion:', error);
    });
  };

  const header = (
    <View>
      <View style={styles.hero}>
        <View style={[styles.cover, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {artwork ? (
            <Image source={{ uri: artwork }} style={StyleSheet.absoluteFill} />
          ) : kind === 'artist' ? (
            <User size={58} color={colors.mutedForeground} />
          ) : (
            <Disc size={58} color={colors.mutedForeground} />
          )}
        </View>
        <Text style={[styles.heroTitle, { color: colors.foreground }]} numberOfLines={2}>{title}</Text>
        {subtitle ? <Text style={[styles.heroSubtitle, { color: colors.mutedForeground }]}>{subtitle}</Text> : null}
        <Text style={[styles.localMeta, { color: colors.mutedForeground }]}>
          {tracks.length} canciones, {formatDuration(totalDuration)}
        </Text>
        <TouchableOpacity
          onPress={() => void playFrom(0)}
          style={[styles.playButton, { backgroundColor: colors.primary }]}
        >
          <Play size={18} color={colors.primaryForeground} fill={colors.primaryForeground} />
          <Text style={[styles.playText, { color: colors.primaryForeground }]}>Reproducir</Text>
        </TouchableOpacity>
      </View>

      {kind === 'artist' && (profileLoading || profile) ? (
        <View style={[styles.infoBand, { borderColor: colors.border }]}>
          {profileLoading ? (
            <ActivityIndicator color={colors.primary} />
          ) : profile ? (
            <>
              <Text style={[styles.infoTitle, { color: colors.foreground }]}>Informacion del artista</Text>
              <Text style={[styles.infoCopy, { color: colors.mutedForeground }]}>
                {[profile.type, profile.area || profile.country, profile.begin ? `Activo desde ${profile.begin}` : '']
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
              {profile.disambiguation ? (
                <Text style={[styles.disambiguation, { color: colors.mutedForeground }]}>{profile.disambiguation}</Text>
              ) : null}
              {profile.tags.length ? (
                <Text style={[styles.tags, { color: colors.primary }]}>{profile.tags.join(' · ')}</Text>
              ) : null}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.links}>
                {profile.socialLinks.map((link) => (
                  <TouchableOpacity
                    key={link.url}
                    onPress={() => void Linking.openURL(link.url)}
                    style={[styles.linkButton, { backgroundColor: colors.secondary, borderColor: colors.border }]}
                  >
                    <ExternalLink size={14} color={colors.foreground} />
                    <Text style={[styles.linkText, { color: colors.foreground }]}>{link.label}</Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  onPress={() => void Linking.openURL(profile.musicBrainzUrl)}
                  style={[styles.linkButton, { backgroundColor: colors.secondary, borderColor: colors.border }]}
                >
                  <ExternalLink size={14} color={colors.foreground} />
                  <Text style={[styles.linkText, { color: colors.foreground }]}>MusicBrainz</Text>
                </TouchableOpacity>
              </ScrollView>
            </>
          ) : null}
        </View>
      ) : null}

      {kind === 'album' && qualityBadges.length ? (
        <View style={[styles.infoBand, { borderColor: colors.border }]}>
          <Text style={[styles.infoTitle, { color: colors.foreground }]}>Calidad local</Text>
          <Text style={[styles.tags, { color: colors.primary }]}>{qualityBadges.join(' · ')}</Text>
        </View>
      ) : null}

      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Canciones</Text>
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.toolbar, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={onBack} style={styles.toolbarButton} accessibilityLabel="Volver">
          <ChevronLeft size={23} color={colors.foreground} />
        </TouchableOpacity>
        <Text numberOfLines={1} style={[styles.toolbarTitle, { color: colors.foreground }]}>{title}</Text>
        <View style={styles.toolbarButton} />
      </View>

      <FlashList
        data={tracks}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={header}
        contentContainerStyle={styles.listContent}
        renderItem={({ item, index }) => {
          const rowArtwork = item.artwork_thumb || item.artwork;
          const isActive = item.id === currentTrackId;
          return (
            <TouchableOpacity
              onPress={() => void playFrom(index)}
              style={[styles.row, { borderBottomColor: colors.border }, isActive && { backgroundColor: colors.secondary }]}
            >
              <Text style={[styles.index, { color: colors.mutedForeground }]}>{index + 1}</Text>
              <View style={[styles.rowArtwork, { backgroundColor: colors.muted }]}>
                {rowArtwork ? <Image source={{ uri: rowArtwork }} style={StyleSheet.absoluteFill} /> : <Disc size={17} color={colors.mutedForeground} />}
              </View>
              <View style={styles.rowCopy}>
                <Text numberOfLines={1} style={[styles.rowTitle, { color: isActive ? colors.primary : colors.foreground }]}>{item.title}</Text>
                <Text numberOfLines={1} style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>{item.artist}</Text>
              </View>
              <TouchableOpacity
                onPress={(event) => {
                  event.stopPropagation();
                  setSelectedTrack(item);
                }}
                style={styles.rowMenu}
                accessibilityLabel="Mas opciones"
              >
                <MoreVertical size={19} color={colors.mutedForeground} />
              </TouchableOpacity>
            </TouchableOpacity>
          );
        }}
      />

      <TrackOptionsModal
        visible={Boolean(selectedTrack)}
        track={selectedTrack}
        onClose={() => setSelectedTrack(null)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  toolbar: { height: 66, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 10 },
  toolbarButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  toolbarTitle: { flex: 1, minWidth: 0, textAlign: 'center', fontSize: 16, fontWeight: '800' },
  listContent: { paddingBottom: 125 },
  hero: { alignItems: 'center', paddingTop: 22, paddingHorizontal: 20, paddingBottom: 20 },
  cover: { width: 190, height: 190, borderRadius: 8, borderWidth: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  heroTitle: { fontSize: 27, fontWeight: '900', textAlign: 'center', marginTop: 15 },
  heroSubtitle: { fontSize: 14, fontWeight: '600', marginTop: 5, textAlign: 'center' },
  localMeta: { fontSize: 12, marginTop: 5 },
  playButton: { height: 44, minWidth: 146, borderRadius: 7, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 15, paddingHorizontal: 18 },
  playText: { fontSize: 13, fontWeight: '800', textTransform: 'uppercase' },
  infoBand: { borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 18, paddingVertical: 16 },
  infoTitle: { fontSize: 15, fontWeight: '800' },
  infoCopy: { fontSize: 12, lineHeight: 18, marginTop: 5 },
  disambiguation: { fontSize: 12, lineHeight: 18, marginTop: 5 },
  tags: { fontSize: 12, fontWeight: '700', marginTop: 7 },
  links: { gap: 8, paddingTop: 12, paddingRight: 10 },
  linkButton: { height: 36, borderRadius: 6, borderWidth: 1, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
  linkText: { fontSize: 12, fontWeight: '700' },
  sectionTitle: { fontSize: 17, fontWeight: '800', paddingHorizontal: 16, paddingTop: 20, paddingBottom: 8 },
  row: { minHeight: 61, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  index: { width: 27, fontSize: 11, textAlign: 'center' },
  rowArtwork: { width: 41, height: 41, borderRadius: 5, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  rowCopy: { flex: 1, minWidth: 0, paddingHorizontal: 11 },
  rowTitle: { fontSize: 14, fontWeight: '700' },
  rowSubtitle: { fontSize: 11, marginTop: 3 },
  rowMenu: { width: 40, height: 42, alignItems: 'center', justifyContent: 'center' },
});
