import React, { useMemo } from "react";
import { View, Text, TouchableOpacity, Image, FlatList, Platform, Dimensions, StyleSheet } from "react-native";
import Animated, { useSharedValue, useAnimatedScrollHandler } from "react-native-reanimated";
import { User } from "lucide-react-native";
import { Track } from "../components/PlayerBar";
import { AnimatedHeader } from "../components/AnimatedHeader";

const AnimatedFlatList = Animated.createAnimatedComponent(FlatList as any);
const { width } = Dimensions.get("window");
const CARD_WIDTH = (width - 44) / 2;

export interface ArtistsScreenProps {
  tracks: Track[];
  onSelectTrack: (track: Track) => void;
  onOpenSidebar: () => void;
  currentTrackId?: string;
}

interface ArtistEntry {
  name: string;
  artwork?: string;
  trackCount: number;
  tracks: Track[];
}

export const ArtistsScreen: React.FC<ArtistsScreenProps> = ({ tracks, onSelectTrack, onOpenSidebar }) => {
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

  const artists = useMemo<ArtistEntry[]>(() => {
    const map = new Map<string, ArtistEntry>();
    for (const track of tracks) {
      const name = (track.artist && track.artist !== "Unknown Artist" && track.artist !== "Local Library")
        ? track.artist : "Artista desconocido";
      if (!map.has(name)) map.set(name, { name, artwork: track.artwork, trackCount: 0, tracks: [] });
      const entry = map.get(name)!;
      entry.trackCount += 1;
      entry.tracks.push(track);
      if (!entry.artwork && track.artwork) entry.artwork = track.artwork;
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [tracks]);

  const renderArtist = ({ item }: { item: ArtistEntry }) => (
    <TouchableOpacity
      onPress={() => item.tracks[0] && onSelectTrack(item.tracks[0])}
      activeOpacity={0.8}
      style={{ width: CARD_WIDTH, marginBottom: 20 }}
    >
      <View style={{ width: CARD_WIDTH, height: CARD_WIDTH, borderRadius: 16, backgroundColor: "#1c1c1e", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
        {item.artwork ? (
          <Image source={{ uri: item.artwork }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <User size={40} color="#6b7280" />
        )}
      </View>
      <View style={{ marginTop: 8, paddingHorizontal: 4 }}>
        <Text numberOfLines={1} style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>{item.name}</Text>
        <Text style={{ color: "#9ca3af", fontSize: 12, fontWeight: "500", marginTop: 2 }}>{item.trackCount} {item.trackCount === 1 ? "canción" : "canciones"}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <AnimatedHeader title="Artistas" headerTranslationY={headerTranslationY} onOpenSidebar={onOpenSidebar} />
      {artists.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 }}>
          <User size={52} color="#3f3f46" />
          <Text style={{ color: "#fff", fontSize: 18, fontWeight: "800", marginTop: 16, textAlign: "center" }}>Sin artistas</Text>
          <Text style={{ color: "#6b7280", fontSize: 13, marginTop: 8, textAlign: "center", lineHeight: 20 }}>Escanea tu música desde Inicio para ver tus artistas aquí.</Text>
        </View>
      ) : Platform.OS === "web" ? (
        <FlatList
          data={artists}
          keyExtractor={(item) => item.name}
          renderItem={renderArtist}
          numColumns={2}
          columnWrapperStyle={{ justifyContent: "space-between", paddingHorizontal: 16 }}
          contentContainerStyle={{ paddingTop: 100, paddingBottom: 130 }}
          showsVerticalScrollIndicator={false}
        />
      ) : (
        <AnimatedFlatList
          data={artists}
          keyExtractor={(item: any) => item.name}
          renderItem={renderArtist}
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
