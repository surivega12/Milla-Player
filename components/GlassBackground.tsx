import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useTheme } from '../context/ThemeContext';

interface GlassBackgroundProps {
  artworkUrl?: string;
  vibrantColor?: string;
}

export const GlassBackground: React.FC<GlassBackgroundProps> = ({ artworkUrl }) => {
  const { currentTheme, colors } = useTheme();
  const isLight = currentTheme === 'theme-white' || currentTheme === 'theme-latte';

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background, overflow: 'hidden' }]}>
      {artworkUrl ? (
        <Image
          source={{ uri: artworkUrl }}
          style={[StyleSheet.absoluteFill, styles.artwork, { opacity: isLight ? 0.12 : 0.22 }]}
          blurRadius={32}
          resizeMode="cover"
        />
      ) : null}
      {artworkUrl ? (
        <BlurView intensity={65} tint={isLight ? 'light' : 'dark'} style={StyleSheet.absoluteFill} />
      ) : null}
      <View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: colors.background, opacity: artworkUrl ? (isLight ? 0.72 : 0.64) : 1 },
        ]}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  artwork: { transform: [{ scale: 1.2 }] },
});
