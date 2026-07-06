import React from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import {
  Menu,
  Sliders,
  Database,
  Info,
  ChevronRight,
  Disc,
  Trash2,
  Cpu,
} from 'lucide-react-native';
import { getThemeColors } from '../utils/theme-colors';

interface SettingsScreenProps {
  onOpenSidebar: () => void;
  currentTheme: string;
  onSelectTheme: (theme: string) => void;
  bufferMode: 'aggressive' | 'balanced' | 'eco';
  onSelectBufferMode: (mode: 'aggressive' | 'balanced' | 'eco') => void;
  audioQuality: 'hires' | 'hq' | 'standard';
  onSelectAudioQuality: (quality: 'hires' | 'hq' | 'standard') => void;
  onClearCache: () => void;
  cacheSize: string;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  onOpenSidebar,
  currentTheme,
  onSelectTheme,
  bufferMode,
  onSelectBufferMode,
  audioQuality,
  onSelectAudioQuality,
  onClearCache,
  cacheSize,
}) => {
  const colors = getThemeColors(currentTheme);

  const handleClearCachePress = () => {
    Alert.alert(
      'Clean Storage',
      'Are you sure you want to delete all downloaded music files?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete All', style: 'destructive', onPress: onClearCache },
      ]
    );
  };

  return (
    <View className="flex-1">
      {/* Cabecera Superior (Top Nav) */}
      <View className="flex-row items-center justify-between px-5 pt-14 pb-4">
        <TouchableOpacity
          onPress={onOpenSidebar}
          hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
          className="w-10 h-10 rounded-xl bg-[var(--card)]/80 border border-[var(--border)]/60 items-center justify-center shadow-md"
        >
          <Menu size={22} color={colors.foreground} />
        </TouchableOpacity>

        <View className="items-center">
          <Text className="text-xs font-black tracking-widest text-[var(--muted-foreground)] uppercase">
            System Preferences
          </Text>
          <Text className="text-lg font-black tracking-wide text-[var(--foreground)]">
            MILLA SETTINGS
          </Text>
        </View>

        <View className="w-10 h-10 rounded-xl bg-[var(--primary)]/15 border border-[var(--primary)]/40 items-center justify-center">
          <Sliders size={20} color={colors.primary} />
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        
        {/* Sección 1: Calidad de Audio */}
        <View className="mx-5 mt-4 mb-6">
          <View className="flex-row items-center gap-2 mb-3 px-2">
            <Disc size={15} color={colors.primary} />
            <Text className="text-xs font-black tracking-wider text-[var(--muted-foreground)] uppercase">
              Audio Engine Quality
            </Text>
          </View>

          <View className="bg-[var(--card)]/80 border border-[var(--border)]/60 rounded-2xl overflow-hidden p-2 gap-1.5">
            {[
              { id: 'hires', title: 'Audiophile Lossless', desc: 'FLAC 24-bit/192kHz • Bit-perfect' },
              { id: 'hq', title: 'High Quality', desc: 'MP3 320kbps • Compressed balanced' },
              { id: 'standard', title: 'Standard', desc: 'AAC 128kbps • Mobile data safe' },
            ].map((item) => {
              const isSelected = audioQuality === item.id;
              return (
                <TouchableOpacity
                  key={item.id}
                  onPress={() => onSelectAudioQuality(item.id as any)}
                  activeOpacity={0.7}
                  className={`p-3.5 rounded-xl flex-row items-center justify-between border ${
                    isSelected
                      ? 'bg-[var(--primary)]/10 border-[var(--primary)]/60'
                      : 'border-transparent'
                  }`}
                >
                  <View className="flex-1 mr-2">
                    <Text className={`text-sm font-bold ${isSelected ? 'text-[var(--primary)]' : 'text-[var(--foreground)]'}`}>
                      {item.title}
                    </Text>
                    <Text className="text-xs text-[var(--muted-foreground)] mt-0.5">
                      {item.desc}
                    </Text>
                  </View>
                  <View className={`w-4 h-4 rounded-full border items-center justify-center ${isSelected ? 'border-[var(--primary)]' : 'border-[var(--border)]'}`}>
                    {isSelected && <View className="w-2.5 h-2.5 rounded-full bg-[var(--primary)]" />}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Sección 2: Búfer de Audio */}
        <View className="mx-5 mb-6">
          <View className="flex-row items-center gap-2 mb-3 px-2">
            <Cpu size={15} color={colors.primary} />
            <Text className="text-xs font-black tracking-wider text-[var(--muted-foreground)] uppercase">
              Decoders & Buffer Profiles
            </Text>
          </View>

          <View className="bg-[var(--card)]/80 border border-[var(--border)]/60 rounded-2xl overflow-hidden p-2 gap-1.5">
            {[
              { id: 'aggressive', title: 'Audiophile Aggressive', desc: '50s pre-buffer • 5GB cache • Anti-stutter' },
              { id: 'balanced', title: 'Balanced Buffer', desc: '20s pre-buffer • 1GB cache • Standard' },
              { id: 'eco', title: 'Eco Mode', desc: '8s pre-buffer • 256MB cache • Battery saving' },
            ].map((item) => {
              const isSelected = bufferMode === item.id;
              return (
                <TouchableOpacity
                  key={item.id}
                  onPress={() => onSelectBufferMode(item.id as any)}
                  activeOpacity={0.7}
                  className={`p-3.5 rounded-xl flex-row items-center justify-between border ${
                    isSelected
                      ? 'bg-[var(--primary)]/10 border-[var(--primary)]/60'
                      : 'border-transparent'
                  }`}
                >
                  <View className="flex-1 mr-2">
                    <Text className={`text-sm font-bold ${isSelected ? 'text-[var(--primary)]' : 'text-[var(--foreground)]'}`}>
                      {item.title}
                    </Text>
                    <Text className="text-xs text-[var(--muted-foreground)] mt-0.5">
                      {item.desc}
                    </Text>
                  </View>
                  <View className={`w-4 h-4 rounded-full border items-center justify-center ${isSelected ? 'border-[var(--primary)]' : 'border-[var(--border)]'}`}>
                    {isSelected && <View className="w-2.5 h-2.5 rounded-full bg-[var(--primary)]" />}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Sección 3: Almacenamiento y Descargas */}
        <View className="mx-5 mb-6">
          <View className="flex-row items-center gap-2 mb-3 px-2">
            <Database size={15} color={colors.primary} />
            <Text className="text-xs font-black tracking-wider text-[var(--muted-foreground)] uppercase">
              Storage & Offline Mode
            </Text>
          </View>

          <View className="bg-[var(--card)]/80 border border-[var(--border)]/60 rounded-2xl overflow-hidden p-4 gap-4">
            <View className="flex-row items-center justify-between">
              <View>
                <Text className="text-sm font-bold text-[var(--foreground)]">Offline Storage Size</Text>
                <Text className="text-xs text-[var(--muted-foreground)] mt-0.5">Space consumed by downloaded files</Text>
              </View>
              <Text className="text-sm font-black text-[var(--primary)]">{cacheSize}</Text>
            </View>

            <View className="h-px bg-[var(--border)]/60" />

            <TouchableOpacity
              onPress={handleClearCachePress}
              activeOpacity={0.8}
              className="flex-row items-center justify-center gap-2 p-3.5 bg-red-500/10 border border-red-500/30 rounded-xl"
            >
              <Trash2 size={16} color="#ef4444" />
              <Text className="text-xs font-bold text-red-500 uppercase tracking-wider">
                Clear Offline Downloads
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Sección 4: Créditos e Información */}
        <View className="mx-5 mb-6">
          <View className="flex-row items-center gap-2 mb-3 px-2">
            <Info size={15} color={colors.primary} />
            <Text className="text-xs font-black tracking-wider text-[var(--muted-foreground)] uppercase">
              Milla Project Info
            </Text>
          </View>

          <View className="bg-[var(--card)]/80 border border-[var(--border)]/60 rounded-2xl overflow-hidden p-4 gap-3">
            <View className="flex-row justify-between items-center py-1">
              <Text className="text-xs text-[var(--muted-foreground)]">Developer</Text>
              <Text className="text-xs font-bold text-[var(--foreground)]">Senior Full-Stack</Text>
            </View>
            <View className="flex-row justify-between items-center py-1">
              <Text className="text-xs text-[var(--muted-foreground)]">Platform</Text>
              <Text className="text-xs font-bold text-[var(--foreground)]">Expo Native Core</Text>
            </View>
            <View className="flex-row justify-between items-center py-1">
              <Text className="text-xs text-[var(--muted-foreground)]">Audio Engine</Text>
              <Text className="text-xs font-bold text-[var(--foreground)]">ExoPlayer/AVFoundation</Text>
            </View>
            <View className="flex-row justify-between items-center py-1">
              <Text className="text-xs text-[var(--muted-foreground)]">Version</Text>
              <Text className="text-xs font-mono font-bold text-[var(--foreground)]">v1.0.0 Stable</Text>
            </View>
          </View>
        </View>

      </ScrollView>
    </View>
  );
};
