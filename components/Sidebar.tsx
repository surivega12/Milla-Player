import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Alert, Image, Linking } from 'react-native';
import { BlurView } from 'expo-blur';
import {
  Home,
  Library,
  Clock,
  LayoutGrid,
  HeartHandshake,
  Settings,
  Code,
  ListMusic,
} from 'lucide-react-native';
import { useTheme } from '../context/ThemeContext';

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
  icon: any;
  showProgress?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'home', label: 'Inicio', icon: Home },
  { id: 'library', label: 'Biblioteca', icon: Library },
  { id: 'playlists', label: 'Playlists', icon: ListMusic },
  { id: 'artistas', label: 'Artistas', icon: Clock },
  { id: 'álbumes', label: 'Álbumes', icon: LayoutGrid },
  { id: 'donate', label: 'Donar', icon: HeartHandshake, showProgress: true },
  { id: 'configuraciones', label: 'Configuraciones', icon: Settings },
];

const FOOTER_ITEMS: NavItem[] = [
  { id: 'github', label: 'GitHub', icon: Code },
];

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  onClose,
  activeTab,
  onSelectTab,
}) => {
  const { colors } = useTheme();
  if (!isOpen) {
    return null;
  }

  const handleNavPress = (tabId: string) => {
    if (tabId === 'donate') {
      Linking.openURL('https://ko-fi.com/milla_app').catch(() => {
        Alert.alert('Donate to Milla', 'Visit https://ko-fi.com/milla_app to support Milla Hi-Res Audio Engine!');
      });
    } else {
      onSelectTab(tabId);
      onClose();
    }
  };

  const handleFooterPress = (item: NavItem) => {
    if (item.id === 'github') {
      Linking.openURL('https://github.com/surivega12/Milla-Player').catch(() => {
        Alert.alert('GitHub Repository', 'https://github.com/surivega12/Milla-Player');
      });
    } else {
      Alert.alert(item.label, `${item.label} feature integration coming soon.`);
    }
  };

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 999 }]}>
      {/* Fondo translúcido oscuro sobre toda la pantalla */}
      <TouchableOpacity
        style={StyleSheet.absoluteFill}
        activeOpacity={1}
        onPress={onClose}
      >
        <BlurView intensity={20} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0, 0, 0, 0.65)' }]} />
      </TouchableOpacity>

      {/* Panel del Menú Lateral (Negro mate/ultra oscuro sólido #0F1011) */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          width: 280,
          backgroundColor: colors.background,
          paddingTop: 56,
          paddingBottom: 32,
          paddingHorizontal: 20,
          shadowColor: '#000000',
          shadowOffset: { width: 4, height: 0 },
          shadowOpacity: 0.6,
          shadowRadius: 20,
          elevation: 30,
        }}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 24 }}
          showsVerticalScrollIndicator={false}
        >
          {/* CABECERA (Header): Logo oficial de Milla y título "MILLA" */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 32, paddingHorizontal: 4 }}>
            <Image
              source={require('../assets/logo.png')}
              style={{ width: 36, height: 36, resizeMode: 'contain', marginRight: 12, tintColor: colors.foreground }}
            />
            <Text
              style={{
                fontSize: 22,
                fontWeight: '800',
                color: colors.foreground,
                letterSpacing: 0.5,
              }}
            >
              MILLA
            </Text>
          </View>

          {/* MENÚ PRINCIPAL (Vistas) */}
          <View style={{ marginBottom: 12 }}>
            {NAV_ITEMS.map((item) => {
              const isActive = activeTab === item.id;

              return (
                <View key={item.id} style={{ marginBottom: 6 }}>
                  <TouchableOpacity
                    onPress={() => handleNavPress(item.id)}
                    activeOpacity={0.8}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingVertical: 12,
                      paddingHorizontal: 16,
                      borderRadius: 12,
                      backgroundColor: isActive ? colors.primary : 'transparent',
                    }}
                  >
                    <item.icon
                      size={20}
                      color={isActive ? colors.primaryForeground : colors.mutedForeground}
                      style={{ marginRight: 14 }}
                    />
                    <Text
                      style={{
                        fontSize: 16,
                        fontWeight: isActive ? '700' : '500',
                        color: isActive ? colors.primaryForeground : colors.foreground,
                        letterSpacing: -0.2,
                      }}
                    >
                      {item.label}
                    </Text>
                  </TouchableOpacity>

                  {/* Barra de progreso minimalista para Donate (22%) */}
                  {item.showProgress && (
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        marginTop: 4,
                        marginLeft: 46,
                        paddingRight: 16,
                      }}
                    >
                      <View
                        style={{
                          flex: 1,
                          height: 2,
                          backgroundColor: '#262626',
                          borderRadius: 1,
                          overflow: 'hidden',
                        }}
                      >
                        <View
                          style={{
                            width: '22%',
                            height: 2,
                            backgroundColor: isActive ? '#FFFFFF' : '#D1D5DB',
                          }}
                        />
                      </View>
                      <Text
                        style={{
                          fontSize: 11,
                          fontWeight: '600',
                          color: '#9CA3AF',
                          marginLeft: 10,
                        }}
                      >
                        22%
                      </Text>
                    </View>
                  )}
                </View>
              );
            })}
          </View>

          {/* DIVISOR (línea horizontal muy delgada, sutil y semi-transparente) */}
          <View
            style={{
              height: 1,
              backgroundColor: 'rgba(255, 255, 255, 0.08)',
              marginVertical: 18,
            }}
          />

          {/* PIE DE PÁGINA (Footer - Textos más pequeños y grisáceos) */}
          <View style={{ gap: 4 }}>
            {FOOTER_ITEMS.map((item) => (
              <TouchableOpacity
                key={item.id}
                onPress={() => handleFooterPress(item)}
                activeOpacity={0.7}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingVertical: 10,
                  paddingHorizontal: 16,
                  borderRadius: 10,
                }}
              >
                <item.icon
                  size={18}
                  color="#9CA3AF"
                  style={{ marginRight: 14 }}
                />
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: '500',
                    color: '#9CA3AF',
                    letterSpacing: -0.1,
                  }}
                >
                  {item.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      </View>
    </View>
  );
};
