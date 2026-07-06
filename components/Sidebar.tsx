import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import {
  Home,
  Library,
  Clock,
  Sparkles,
  HeartHandshake,
  Settings,
  X,
  Disc,
  Pin,
} from 'lucide-react-native';
import { getThemeColors } from '../utils/theme-colors';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: string;
  onSelectTab: (tab: string) => void;
  currentTheme?: string;
}

interface NavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ size: number; color: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'library', label: 'Library', icon: Library },
  { id: 'recent', label: 'Recent', icon: Clock },
  { id: 'unreleased', label: 'Unreleased', icon: Sparkles },
  { id: 'donate', label: 'Donate', icon: HeartHandshake },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const PINNED_ITEMS = [
  { id: 'pin-1', title: 'Monochrome Favorites', type: 'Playlist' },
  { id: 'pin-2', title: 'FLAC 192kHz Essentials', type: 'Playlist' },
  { id: 'pin-3', title: 'Late Night Synthwave', type: 'Album' },
];

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  onClose,
  activeTab,
  onSelectTab,
  currentTheme = 'theme-monochrome',
}) => {
  const colors = getThemeColors(currentTheme);

  if (!isOpen) {
    return null;
  }

  const handleNavPress = (tabId: string) => {
    onSelectTab(tabId);
    onClose();
  };

  return (
    <View style={StyleSheet.absoluteFill} className="z-50">
      {/* Fondo translúcido que difumina la pantalla detrás del menú */}
      <TouchableOpacity
        style={StyleSheet.absoluteFill}
        activeOpacity={1}
        onPress={onClose}
      >
        <BlurView intensity={25} tint="dark" style={StyleSheet.absoluteFill} />
        <View className="flex-1 bg-black/60" />
      </TouchableOpacity>

      {/* Panel Deslizante del Menú Lateral */}
      <View className="absolute top-0 bottom-0 left-0 w-72 bg-[var(--card)] z-50 border-r border-[var(--border)] pt-14 pb-8 px-5 justify-between shadow-2xl">
        
        {/* Sección Superior: Cabecera y Navegación Principal */}
        <View className="flex-1">
          {/* Cabecera del Logo */}
          <View className="flex-row items-center justify-between mb-8 px-2">
            <View className="flex-row items-center gap-2.5">
              <View className="w-9 h-9 rounded-xl bg-[var(--primary)] items-center justify-center shadow-md">
                <Disc size={22} color={colors.primaryForeground} />
              </View>
              <View>
                <Text className="text-xl font-black tracking-wider text-[var(--foreground)]">
                  MILLA
                </Text>
                <Text className="text-[9px] uppercase tracking-widest text-[var(--primary)] font-bold">
                  Hi-Res Audio Engine
                </Text>
              </View>
            </View>

            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              className="p-1 rounded-lg bg-[var(--secondary)]/60"
            >
              <X size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          {/* Lista de Navegación Principal */}
          <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
            <View className="gap-1.5 mb-8">
              {NAV_ITEMS.map((item) => {
                const IconComponent = item.icon;
                const isActive = activeTab === item.id;

                return (
                  <TouchableOpacity
                    key={item.id}
                    onPress={() => handleNavPress(item.id)}
                    activeOpacity={0.75}
                    className={`flex-row items-center gap-3.5 px-3.5 py-3 rounded-xl transition-all ${
                      isActive
                        ? 'bg-[var(--primary)]/15 border-l-4 border-[var(--primary)]'
                        : 'hover:bg-[var(--secondary)]/40'
                    }`}
                  >
                    <IconComponent
                      size={20}
                      color={isActive ? colors.primary : colors.mutedForeground}
                    />
                    <Text
                      className={`text-sm tracking-wide ${
                        isActive
                          ? 'font-bold text-[var(--primary)]'
                          : 'font-medium text-[var(--muted-foreground)]'
                      }`}
                    >
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Sección de Elementos Fijados (Pinned Items estilo Monochrome) */}
            <View className="px-2 mb-6">
              <View className="flex-row items-center gap-2 mb-3">
                <Pin size={12} color={colors.mutedForeground} />
                <Text className="text-[11px] font-bold tracking-wider text-[var(--muted-foreground)] uppercase">
                  Pinned Library
                </Text>
              </View>

              <View className="gap-2">
                {PINNED_ITEMS.map((pin) => (
                  <TouchableOpacity
                    key={pin.id}
                    onPress={() => onClose()}
                    activeOpacity={0.7}
                    className="p-2.5 rounded-xl bg-[var(--secondary)]/30 border border-[var(--border)]/30 flex-row items-center justify-between"
                  >
                    <View className="flex-1 mr-2">
                      <Text
                        className="text-xs font-semibold text-[var(--foreground)]"
                        numberOfLines={1}
                      >
                        {pin.title}
                      </Text>
                      <Text className="text-[10px] text-[var(--muted-foreground)] mt-0.5">
                        {pin.type}
                      </Text>
                    </View>
                    <View className="w-1.5 h-1.5 rounded-full bg-[var(--primary)]/60" />
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </ScrollView>
        </View>

        {/* Pie del Menú: Estado del Motor de Audio y Versión */}
        <View className="pt-4 border-t border-[var(--border)]/50">
          <View className="p-3 rounded-xl bg-[var(--secondary)]/50 border border-[var(--border)]/40">
            <View className="flex-row items-center gap-2 mb-1">
              <View className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <Text className="text-xs font-bold text-[var(--foreground)]">
                Audio Engine Active
              </Text>
            </View>
            <Text className="text-[10px] text-[var(--muted-foreground)] font-medium">
              v1.0.0 Native • Direct Hardware FLAC
            </Text>
          </View>
        </View>

      </View>
    </View>
  );
};
