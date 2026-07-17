import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import Animated, { useAnimatedStyle, useAnimatedReaction, runOnJS, SharedValue } from 'react-native-reanimated';
import { Search, MoreVertical } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export interface AnimatedHeaderProps {
  title: string;
  headerTranslationY: SharedValue<number>;
  onOpenSidebar: () => void;
  onSearchPress?: () => void;
}

// Web fallback: animates via direct DOM style updates synced to the shared value
const WebAnimatedHeader: React.FC<AnimatedHeaderProps & { HEADER_HEIGHT: number }> = ({
  title, headerTranslationY, onOpenSidebar, onSearchPress, HEADER_HEIGHT
}) => {
  const containerRef = useRef<any>(null);

  // Subscribe to changes on the worklet thread and push to DOM
  useAnimatedReaction(
    () => headerTranslationY.value,
    (value) => {
      runOnJS((v: number) => {
        if (containerRef.current) {
          const el = containerRef.current as any;
          if (el.style) {
            el.style.transform = `translateY(${v}px)`;
            el.style.opacity = v < -(HEADER_HEIGHT - 20) ? '0' : '1';
          }
        }
      })(value);
    }
  );

  return (
    <View
      ref={containerRef}
      style={[
        styles.container,
        { paddingTop: 0, height: HEADER_HEIGHT, zIndex: 10 },
        // @ts-ignore — web-only transition
        { transition: 'transform 0.1s ease-out, opacity 0.1s ease-out' },
      ]}
      className="bg-[rgba(15,15,15,0.88)] border-b border-white/10"
    >
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 }}>
        <TouchableOpacity onPress={onSearchPress} activeOpacity={0.7} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
          <Search size={22} color="#E5E7EB" />
        </TouchableOpacity>
        <View style={StyleSheet.absoluteFill} pointerEvents="none" className="items-center justify-center">
          <Text style={{ color: '#fff', fontSize: 18, fontWeight: '600', letterSpacing: 0.3 }}>{title}</Text>
        </View>
        <TouchableOpacity onPress={onOpenSidebar} activeOpacity={0.7} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
          <MoreVertical size={22} color="#E5E7EB" />
        </TouchableOpacity>
      </View>
    </View>
  );
};

export const AnimatedHeader: React.FC<AnimatedHeaderProps> = ({ 
  title, 
  headerTranslationY, 
  onOpenSidebar, 
  onSearchPress 
}) => {
  const insets = useSafeAreaInsets();
  const HEADER_HEIGHT = 60 + insets.top;

  if (Platform.OS === 'web') {
    return (
      <WebAnimatedHeader
        title={title}
        headerTranslationY={headerTranslationY}
        onOpenSidebar={onOpenSidebar}
        onSearchPress={onSearchPress}
        HEADER_HEIGHT={HEADER_HEIGHT}
      />
    );
  }

  const headerStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateY: headerTranslationY.value }],
      opacity: headerTranslationY.value < -(HEADER_HEIGHT - 20) ? 0 : 1,
      zIndex: 10,
    };
  });

  return (
    <Animated.View 
      style={[
        headerStyle, 
        styles.container, 
        { paddingTop: insets.top, height: HEADER_HEIGHT }
      ]} 
      className="bg-[rgba(15,15,15,0.88)] border-b border-white/10"
    >
      <View className="flex-1 flex-row items-center justify-between px-4">
        <TouchableOpacity onPress={onSearchPress} activeOpacity={0.7} className="w-10 h-10 items-center justify-center">
          <Search size={22} color="#E5E7EB" />
        </TouchableOpacity>
        <View style={StyleSheet.absoluteFill} className="items-center justify-center" pointerEvents="none">
          <Text className="text-white text-xl font-semibold tracking-wide">{title}</Text>
        </View>
        <TouchableOpacity onPress={onOpenSidebar} activeOpacity={0.7} className="w-10 h-10 items-center justify-center">
          <MoreVertical size={22} color="#E5E7EB" />
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
});
