import React from 'react';
import { View, Image, StyleSheet, Dimensions } from 'react-native';
import { BlurView } from 'expo-blur';

const { width, height } = Dimensions.get('window');

interface GlassBackgroundProps {
  artworkUrl?: string;
  vibrantColor?: string;
}

export const GlassBackground: React.FC<GlassBackgroundProps> = ({
  artworkUrl,
  vibrantColor = '#3b82f6',
}) => {
  return (
    <View style={StyleSheet.absoluteFill} className="overflow-hidden bg-[var(--background)]">
      {/* 1. Ambient Glowing Orbs con el color vibrante extraído */}
      <View
        style={[
          styles.orbTopLeft,
          { backgroundColor: vibrantColor },
        ]}
      />
      <View
        style={[
          styles.orbBottomRight,
          { backgroundColor: vibrantColor },
        ]}
      />

      {/* 2. Carátula en fondo (escalada para evitar bordes cortados al difuminar) */}
      {artworkUrl ? (
        <Image
          source={{ uri: artworkUrl }}
          style={[StyleSheet.absoluteFill, styles.scaledImage]}
          blurRadius={40}
          resizeMode="cover"
        />
      ) : null}

      {/* 3. Capa de Cristal Esmerilado (expo-blur) */}
      <BlurView
        intensity={85}
        tint="dark"
        style={StyleSheet.absoluteFill}
      />

      {/* 4. Capa de oscurecimiento sutil para contraste de legibilidad Hi-Fi */}
      <View style={[StyleSheet.absoluteFill, styles.contrastOverlay]} />
    </View>
  );
};

const styles = StyleSheet.create({
  scaledImage: {
    transform: [{ scale: 1.35 }],
    opacity: 0.75,
  },
  orbTopLeft: {
    position: 'absolute',
    top: -height * 0.15,
    left: -width * 0.25,
    width: width * 0.9,
    height: width * 0.9,
    borderRadius: 9999,
    opacity: 0.45,
  },
  orbBottomRight: {
    position: 'absolute',
    bottom: -height * 0.15,
    right: -width * 0.25,
    width: width * 0.9,
    height: width * 0.9,
    borderRadius: 9999,
    opacity: 0.35,
  },
  contrastOverlay: {
    backgroundColor: 'rgba(10, 10, 10, 0.45)',
  },
});
