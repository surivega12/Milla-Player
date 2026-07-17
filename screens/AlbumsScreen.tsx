import React, { useMemo } from "react";
import { View, Text, TouchableOpacity, Image, FlatList, Platform, Dimensions, StyleSheet } from "react-native";
import Animated, { useSharedValue, useAnimatedScrollHandler } from "react-native-reanimated";
import { Disc } from "lucide-react-native";
import { Track } from "../components/PlayerBar";
import { AnimatedHeader } from "../components/AnimatedHeader";

const AnimatedFlatList = Animated.createAnimatedComponent(FlatList as any);
const { width } = Dimensions.get("window");
const CARD_WIDTH = (width - 44) / 2;

export interface AlbumsScreenProps {
  tracks: Track[];
  onSelectTrack: (track: Track) => void;
  onOpenSidebar: () => void;
  currentTrackId?: string;
}

interface AlbumEntry {
  name: string;
  artist: string;
  artwork?: string;
  trackCount: number;
  tracks: Track[];
}

export const AlbumsScreen: React.FC<AlbumsScreenProps> = ({ tracks, onSelectTrack, onOpenSidebar }) => {
  const headerTranslationY = useSharedValue(0);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event, ctx: any) => {
      const currentY = event.contentOffset.y;
      const prevY = ctx.prevY ?? 0;
      const deltaY = currentY - prevY;
      let newTranslation = headerTranslationY.value - deltaY;
      if (newTranslation > 0) newTranslation = 0;
      if (newTranslation < -100) newTranslation = -100;
      if (currentY <= 0) newTranslation = 0;
      headerTranslationY.value = newTranslation;
      ctx.prevY = currentY;
    },
    onBeginDrag: (event, ctx: any) => { ctx.prevY = event.contentOffset.y; },
  });

  const albums = useMemo<AlbumEntry[]>(() => {
    const map = new Map<string, AlbumEntry>();
    for (const track of tracks) {
      const name = track.album && track.album !== "Unknown Album" ? track.album : "Álbum desconocido";
      const artist = (track.artist && track.artist !== "Unknown Artist" && track.artist !== "Local Library") ? track.artist : "Artista desconocido";
      const key = `${name}|${artist}`;
      if (!map.has(key)) map.set(key, { name, artist, artwork: track.artwork, trackCount: 0, tracks: [] });
      const entry = map.get(key)!;
      entry.trackCount += 1;
      entry.tracks.push(track);
      if (!entry.artwork && track.artwork) entry.artwork = track.artwork;
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [tracks]);

  const renderAlbum = ({ item }: { item: AlbumEntry }) => (
    <TouchableOpacity
      onPress={() => item.tracks[0] && onSelectTrack(item.tracks[0])}
      activeOpacity={0.8}
      style={{ width: CARD_WIDTH, marginBottom: 20 }}
    >
      <View style={{ width: CARD_WIDTH, height: CARD_WIDTH, borderRadius: 16, backgroundColor: "#1c1c1e", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
        {item.artwork ? (
          <Image source={{ uri: item.artwork }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <Disc size={40} color="#6b7280" />
        )}
      </View>
      <View style={{ marginTop: 8, paddingHorizontal: 4 }}>
        <Text numberOfLines={1} style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>{item.name}</Text>
        <Text numberOfLines={1} style={{ color: "#9ca3af", fontSize: 13, fontWeight: "500", marginTop: 2 }}>{item.artist}</Text>
        <Text style={{ color: "#6b7280", fontSize: 11, fontWeight: "500", marginTop: 1 }}>{item.trackCount} {item.trackCount === 1 ? "canción" : "canciones"}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <AnimatedHeader title="Álbumes" headerTranslationY={headerTranslationY} onOpenSidebar={onOpenSidebar} />
      {albums.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 }}>
          <Disc size={52} color="#3f3f46" />
          <Text style={{ color: "#fff", fontSize: 18, fontWeight: "800", marginTop: 16, textAlign: "center" }}>Sin álbumes</Text>
          <Text style={{ color: "#6b7280", fontSize: 13, marginTop: 8, textAlign: "center", lineHeight: 20 }}>Escanea tu música desde Inicio para ver tus álbumes aquí.</Text>
        </View>
      ) : Platform.OS === "web" ? (
        <FlatList
          data={albums}
          keyExtractor={(item) => `${item.name}|${item.artist}`}
          renderItem={renderAlbum}
          numColumns={2}
          columnWrapperStyle={{ justifyContent: "space-between", paddingHorizontal: 16 }}
          contentContainerStyle={{ paddingTop: 100, paddingBottom: 130 }}
          showsVerticalScrollIndicator={false}
        />
      ) : (
        <AnimatedFlatList
          data={albums}
          keyExtractor={(item: any) => `${item.name}|${item.artist}`}
          renderItem={renderAlbum}
          numColumns={2}
          columnWrapperStyle={{ justifyContent: "space-between", paddingHorizontal: 16 }}
          onScroll={scrollHandler}
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingTop: 100, paddingBottom: 130 }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
};
