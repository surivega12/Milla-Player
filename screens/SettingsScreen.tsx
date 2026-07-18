import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Modal,
  Platform,
  Alert,
  Switch,
  Linking,
} from 'react-native';
import Slider from '@react-native-community/slider';
import * as Notifications from 'expo-notifications';
import {
  AutoMixSettings,
  getAutoMixSettings,
  saveAutoMixSettings,
  getNotificationSetting,
  saveNotificationSetting,
  createLocalBackup,
  restoreLocalBackup,
  listLocalBackups,
} from '../services/database-service';
import { globalVertexQueueManager } from '../services/queue-service';
import Animated, {
  useSharedValue,
  useAnimatedScrollHandler,
} from 'react-native-reanimated';
import {
  Palette,
  Volume2,
  SlidersHorizontal,
  Bell,
  Cpu,
  RotateCcw,
  Info,
  Check,
  X,
  Trash2,
  Database,
  ShieldCheck,
  Disc,
  Download,
  Upload,
  FileText,
} from 'lucide-react-native';
import { AnimatedHeader } from '../components/AnimatedHeader';

const AnimatedScrollView = Animated.createAnimatedComponent(ScrollView);

export interface SettingsScreenProps {
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

interface SettingRowItem {
  id: string;
  title: string;
  description: string;
  Icon: React.ElementType;
  iconBg: string;
  onPress: () => void;
}

const THEMES_LIST = [
  { id: 'monochrome', name: 'Monochrome (Oscuro por defecto)', desc: 'Negro absoluto y blanco puro', color: '#ffffff' },
  { id: 'dark', name: 'Dark (Acento Azul)', desc: 'Oscuro elegante con destellos azules', color: '#60a5fa' },
  { id: 'ocean', name: 'Ocean (Azul Profundo)', desc: 'Tonalidades marinas profundas', color: '#0284c7' },
  { id: 'purple', name: 'Purple (Noche Violeta)', desc: 'Misterioso contraste púrpura', color: '#a855f7' },
  { id: 'forest', name: 'Forest (Verde Bosque)', desc: 'Verdes orgánicos y oscuros', color: '#22c55e' },
  { id: 'mocha', name: 'Mocha (Catppuccin Mocha)', desc: 'Paleta cálida y suave pastel', color: '#f9a8d4' },
  { id: 'macchiato', name: 'Macchiato (Catppuccin)', desc: 'Tonos intermedios equilibrados', color: '#c084fc' },
  { id: 'frappe', name: 'Frappe (Catppuccin)', desc: 'Gris mate y acentos suaves', color: '#94a3b8' },
  { id: 'latte', name: 'Latte (Claro Suave)', desc: 'Tema luminoso de alta legibilidad', color: '#fbbf24' },
  { id: 'white', name: 'White (Blanco Puro)', desc: 'Minimalismo diáfano de alto contraste', color: '#e2e8f0' },
];

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
  const headerTranslationY = useSharedValue(0);
  const [activeModal, setActiveModal] = useState<string | null>(null);

  const [autoMixSettings, setAutoMixSettings] = useState<AutoMixSettings>({
    enabled: false,
    bpm_tolerance: 5,
    harmonic_mode: 'free',
    crossfade_seconds: 0,
    cross_out_enabled: false,
    equalizer_preset: 'flat',
  });

  const [notificationEnabled, setNotificationEnabled] = useState<boolean>(true);
  const [localBackups, setLocalBackups] = useState<{ name: string; uri: string; size?: number }[]>([]);
  const [backupStatusMsg, setBackupStatusMsg] = useState<string>('');

  useEffect(() => {
    let isMounted = true;
    getNotificationSetting().then(val => {
      if (isMounted) setNotificationEnabled(val);
    });
    return () => { isMounted = false; };
  }, []);

  useEffect(() => {
    let isMounted = true;
    if (activeModal === 'audio') {
      getAutoMixSettings().then(settings => {
        if (isMounted && settings) {
          setAutoMixSettings(settings);
        }
      });
    } else if (activeModal === 'backup') {
      listLocalBackups().then(list => {
        if (isMounted) setLocalBackups(list);
      });
    }
    return () => { isMounted = false; };
  }, [activeModal]);

  // 🔒 CANDADO DE EXCLUSIÓN MUTUA EN INTERRUPTORES DE MEZCLA
  const updateAndSaveAutoMixSetting = async (partial: Partial<AutoMixSettings>) => {
    let updated = { ...autoMixSettings, ...partial };

    setAutoMixSettings(updated);
    await saveAutoMixSettings(updated);
    if (typeof globalVertexQueueManager?.syncSettings === 'function') {
      globalVertexQueueManager.syncSettings();
    }
  };

  const handleToggleNotification = async (newVal: boolean) => {
    setNotificationEnabled(newVal);
    await saveNotificationSetting(newVal);
    try {
      if (!newVal) {
        await Notifications.dismissAllNotificationsAsync();
      } else {
        await Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowAlert: true,
            shouldPlaySound: false,
            shouldSetBadge: false,
            shouldShowBanner: true,
            shouldShowList: true,
          }),
        });
      }
    } catch (err) {
      console.log('[Settings] Notificación local actualizada:', err);
    }
  };

  const openSystemEqualizer = async () => {
    if (Platform.OS === 'android') {
      try {
        if (typeof (Linking as any).sendIntent === 'function') {
          await (Linking as any).sendIntent('android.media.action.DISPLAY_AUDIO_EFFECT_CONTROL_PANEL');
        } else {
          await Linking.openSettings();
        }
      } catch (err) {
        console.log('[Settings] Fallo al abrir ecualizador del OS, abriendo ajustes:', err);
        try {
          await Linking.openSettings();
        } catch (e) {}
      }
    } else {
      Alert.alert('Ecualizador de Sonido', 'Los ajustes por hardware se calibran en los Ajustes de Sonido de tu sistema operativo.');
    }
  };

  const handleCreateBackup = async () => {
    setBackupStatusMsg('Creando respaldo comprimido SQLite...');
    const res = await createLocalBackup();
    if (res.success) {
      setBackupStatusMsg(`¡Respaldo creado con éxito!`);
      Alert.alert('Respaldo Completado', `Archivo guardado exitosamente en:\n${res.filePathOrMessage}`);
      const list = await listLocalBackups();
      setLocalBackups(list);
    } else {
      setBackupStatusMsg('Error al crear respaldo.');
      Alert.alert('Error', `No se pudo crear el respaldo:\n${res.filePathOrMessage}`);
    }
  };

  const handleRestoreBackup = async (uri?: string) => {
    setBackupStatusMsg('Restaurando base de datos local...');
    const success = await restoreLocalBackup(uri);
    if (success) {
      setBackupStatusMsg('¡Base de datos restaurada al instante!');
      Alert.alert('Restauración Exitosa', 'Todas tus configuraciones de audio, playlists locales y letras han sido restauradas.');
    } else {
      setBackupStatusMsg('Error en la restauración.');
      Alert.alert('Error', 'No se encontró un archivo de respaldo válido o no pudo leerse.');
    }
  };

  // Scroll handler para animar el AnimatedHeader flotante
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
    onBeginDrag: (event, ctx: any) => {
      ctx.prevY = event.contentOffset.y;
    },
  });

  const handleClearCachePress = () => {
    if (Platform.OS === 'web') {
      const confirmDelete = window.confirm('¿Estás seguro de que deseas eliminar todas las descargas offline y archivos temporales?');
      if (confirmDelete) {
        onClearCache();
        setActiveModal(null);
      }
    } else {
      Alert.alert(
        'Limpiar Almacenamiento',
        '¿Estás seguro de que deseas eliminar todas las descargas offline y archivos temporales de Milla?',
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Eliminar Todo',
            style: 'destructive',
            onPress: () => {
              onClearCache();
              setActiveModal(null);
            },
          },
        ]
      );
    }
  };

  const settingsRows: SettingRowItem[] = [
    {
      id: 'appearance',
      title: 'Apariencia y funcionamiento',
      description: 'Cambiar el tema y colores de la aplicación',
      Icon: Palette,
      iconBg: '#93c5fd', // Azul Pastel
      onPress: () => setActiveModal('appearance'),
    },
    {
      id: 'audio',
      title: 'Audio y Reproducción',
      description: 'Configurar Auto Mix DJ, transiciones armónicas, ecualizador y calidad de audio',
      Icon: Volume2,
      iconBg: '#c4b5fd', // Morado Claro
      onPress: () => setActiveModal('audio'),
    },
    {
      id: 'customize',
      title: 'Personalizar',
      description: 'Personalizar los controles de la interfaz en reproduciendo ahora',
      Icon: SlidersHorizontal,
      iconBg: '#5eead4', // Turquesa/Cian
      onPress: () => setActiveModal('customize'),
    },
    {
      id: 'notification',
      title: 'Notificación',
      description: 'Personaliza el interruptor de alertas y notificaciones locales en segundo plano',
      Icon: Bell,
      iconBg: '#fde047', // Amarillo Pastel
      onPress: () => setActiveModal('notification'),
    },
    {
      id: 'other',
      title: 'Otro',
      description: 'Funciones de prueba avanzadas y limpieza de caché / descargas offline.',
      Icon: Cpu,
      iconBg: '#a5b4fc', // Azul Lavanda
      onPress: () => setActiveModal('other'),
    },
    {
      id: 'backup',
      title: 'Respaldo y restauración',
      description: 'Haga una copia de seguridad y restaure su configuración, playlists',
      Icon: RotateCcw,
      iconBg: '#67e8f9', // Celeste Agua
      onPress: () => setActiveModal('backup'),
    },
    {
      id: 'about',
      title: 'Acerca de',
      description: 'Equipo, enlaces sociales e información de la compilación (Expo Native Core, v1.0.0).',
      Icon: Info,
      iconBg: '#86efac', // Verde Lima
      onPress: () => setActiveModal('about'),
    },
  ];

  const renderRow = (item: SettingRowItem) => (
    <TouchableOpacity
      key={item.id}
      onPress={item.onPress}
      activeOpacity={0.7}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
        paddingHorizontal: 20,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.05)',
      }}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: item.iconBg,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <item.Icon size={22} color="#121212" />
      </View>
      <View style={{ flex: 1, marginLeft: 16 }}>
        <Text
          style={{
            color: '#ffffff',
            fontSize: 16,
            fontWeight: '600',
            letterSpacing: 0.2,
          }}
        >
          {item.title}
        </Text>
        <Text
          style={{
            color: '#9ca3af',
            fontSize: 13,
            marginTop: 3,
            lineHeight: 18,
          }}
        >
          {item.description}
        </Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#000000' }}>
      <AnimatedHeader
        title="Configuración"
        headerTranslationY={headerTranslationY}
        onOpenSidebar={onOpenSidebar}
      />

      {Platform.OS === 'web' ? (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingTop: 100, paddingBottom: 130 }}
        >
          {settingsRows.map(renderRow)}
        </ScrollView>
      ) : (
        <AnimatedScrollView
          showsVerticalScrollIndicator={false}
          onScroll={scrollHandler}
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingTop: 100, paddingBottom: 130 }}
        >
          {settingsRows.map(renderRow)}
        </AnimatedScrollView>
      )}

      {/* ======================= MODAL DE AUDIO Y REPRODUCCIÓN ======================= */}
      <Modal
        visible={activeModal === 'audio'}
        transparent
        animationType="slide"
        onRequestClose={() => setActiveModal(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Audio y Reproducción DJ</Text>
              <TouchableOpacity onPress={() => setActiveModal(null)} style={styles.closeBtn}>
                <X size={20} color="#ffffff" />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
              {/* SECCIÓN 1: MOTOR DJ Y MEZCLA ARMÓNICA */}
              <Text style={styles.sectionHeader}>Motor DJ y Mezcla Armónica</Text>

              <View style={[styles.optionCard, autoMixSettings.enabled && { borderColor: '#B43C12' }]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.optionTitle}>Auto Mix con Inteligencia Armónica</Text>
                  <Text style={styles.optionDesc}>
                    {autoMixSettings.enabled
                      ? 'Activo: Transiciona automáticamente con análisis armónico'
                      : 'Empalma canciones en cola de forma fluida y automática'}
                  </Text>
                </View>
                <Switch
                  value={autoMixSettings.enabled}
                  onValueChange={(val) => updateAndSaveAutoMixSetting({ enabled: val })}
                  trackColor={{ false: '#262626', true: '#B43C12' }}
                  thumbColor="#FFFFFF"
                />
              </View>

              <View style={[styles.optionCard, { flexDirection: 'column', alignItems: 'flex-start' }]}>
                <Text style={styles.optionTitle}>Tolerancia de BPM para Mezcla</Text>
                <Text style={styles.optionDesc}>Horquilla máxima de tempo permitida al transicionar</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, width: '100%' }}>
                  {[
                    { label: '2 BPM (Estricta)', val: 2 },
                    { label: '5 BPM (Normal)', val: 5 },
                    { label: '10 BPM (Amplia)', val: 10 },
                  ].map(item => {
                    const isSelected = autoMixSettings.bpm_tolerance === item.val;
                    return (
                      <TouchableOpacity
                        key={item.val}
                        onPress={() => updateAndSaveAutoMixSetting({ bpm_tolerance: item.val })}
                        style={[
                          styles.capsuleBtn,
                          isSelected && styles.capsuleBtnSelected
                        ]}
                      >
                        <Text style={[styles.capsuleText, isSelected && styles.capsuleTextSelected]}>
                          {item.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={[styles.optionCard, { flexDirection: 'column', alignItems: 'flex-start' }]}>
                <Text style={styles.optionTitle}>Modo de Compatibilidad Camelot</Text>
                <Text style={styles.optionDesc}>Criterio de tonalidades para transiciones armónicas</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, width: '100%' }}>
                  {[
                    { label: 'Estricto', val: 'strict' as const },
                    { label: 'Por Energía', val: 'energy' as const },
                    { label: 'Libre', val: 'free' as const },
                  ].map(item => {
                    const isSelected = autoMixSettings.harmonic_mode === item.val;
                    return (
                      <TouchableOpacity
                        key={item.val}
                        onPress={() => updateAndSaveAutoMixSetting({ harmonic_mode: item.val })}
                        style={[
                          styles.capsuleBtn,
                          isSelected && styles.capsuleBtnSelected
                        ]}
                      >
                        <Text style={[styles.capsuleText, isSelected && styles.capsuleTextSelected]}>
                          {item.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={[styles.optionCard, { flexDirection: 'column', alignItems: 'flex-start' }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.optionTitle}>Duración del Crossfade</Text>
                    <Text style={styles.optionDesc}>
                      Tiempo de desvanecimiento entre la pista actual y la siguiente
                    </Text>
                  </View>
                  <Text style={{ color: '#B43C12', fontSize: 16, fontWeight: '800', marginLeft: 12 }}>
                    {autoMixSettings.crossfade_seconds}s
                  </Text>
                </View>
                <View style={{ width: '100%', marginTop: 12 }}>
                  <Slider
                    style={{ width: '100%', height: 40 }}
                    minimumValue={0}
                    maximumValue={12}
                    step={1}
                    value={autoMixSettings.crossfade_seconds}
                    onValueChange={(val) => updateAndSaveAutoMixSetting({ crossfade_seconds: val })}
                    minimumTrackTintColor="#B43C12"
                    maximumTrackTintColor="#262626"
                    thumbTintColor="#FFFFFF"
                  />
                </View>
              </View>

              <View style={styles.optionCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.optionTitle}>Salida Inteligente (Cross-out)</Text>
                  <Text style={styles.optionDesc}>
                    Desvanece automaticamente el outro instrumental o final vocal
                  </Text>
                </View>
                <Switch
                  value={autoMixSettings.cross_out_enabled}
                  onValueChange={(val) => updateAndSaveAutoMixSetting({ cross_out_enabled: val })}
                  trackColor={{ false: '#262626', true: '#B43C12' }}
                  thumbColor="#FFFFFF"
                />
              </View>

              {/* SECCIÓN 2: ECUALIZADOR DIGITAL Y HARDWARE */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, marginBottom: 10 }}>
                <Text style={[styles.sectionHeader, { marginBottom: 0, marginTop: 0 }]}>Ecualizador de Sonido</Text>
                <TouchableOpacity onPress={openSystemEqualizer} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#262626', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 }}>
                  <Volume2 size={14} color="#B43C12" style={{ marginRight: 6 }} />
                  <Text style={{ color: '#ffffff', fontSize: 12, fontWeight: '700' }}>Abrir EQ del Sistema</Text>
                </TouchableOpacity>
              </View>

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                {[
                  { id: 'flat', label: 'Flat / Normal' },
                  { id: 'bass_boost', label: 'Bass Boost' },
                  { id: 'vocal', label: 'Vocal / Voz' },
                  { id: 'treble', label: 'Treble / Brillo' },
                  { id: 'electronic', label: 'Electronic' },
                  { id: 'acoustic', label: 'Acoustic' },
                ].map(eq => {
                  const isSelected = autoMixSettings.equalizer_preset === eq.id;
                  return (
                    <TouchableOpacity
                      key={eq.id}
                      onPress={() => {
                        updateAndSaveAutoMixSetting({ equalizer_preset: eq.id });
                        if (Platform.OS === 'android' && eq.id !== 'flat') openSystemEqualizer();
                      }}
                      style={[
                        styles.capsuleBtn,
                        { paddingHorizontal: 16, paddingVertical: 10 },
                        isSelected && styles.capsuleBtnSelected
                      ]}
                    >
                      <Text style={[styles.capsuleText, isSelected && styles.capsuleTextSelected]}>
                        {eq.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* SECCIÓN 3: CALIDAD Y BUFFER */}
              <Text style={[styles.sectionHeader, { marginTop: 24 }]}>Calidad del Motor de Audio</Text>
              {[
                { id: 'hires', title: 'Audiophile Lossless', desc: 'FLAC 24-bit/192kHz • Bit-perfect' },
                { id: 'hq', title: 'High Quality', desc: 'MP3 320kbps • Audio balanceado comprimido' },
                { id: 'standard', title: 'Standard', desc: 'AAC 128kbps • Ahorro de datos móviles' },
              ].map((q) => {
                const selected = audioQuality === q.id;
                return (
                  <TouchableOpacity
                    key={q.id}
                    style={[styles.optionCard, selected && styles.optionCardSelected]}
                    onPress={() => onSelectAudioQuality(q.id as any)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.optionTitle, selected && { color: '#818cf8' }]}>{q.title}</Text>
                      <Text style={styles.optionDesc}>{q.desc}</Text>
                    </View>
                    {selected && <Check size={20} color="#818cf8" />}
                  </TouchableOpacity>
                );
              })}

              <Text style={[styles.sectionHeader, { marginTop: 20 }]}>Decodificadores y Perfiles de Buffer</Text>
              {[
                { id: 'aggressive', title: 'Audiophile Aggressive', desc: '50s pre-buffer • 5GB cache • Anti-stutter' },
                { id: 'balanced', title: 'Balanced Buffer', desc: '20s pre-buffer • 1GB cache • Estándar recomendado' },
                { id: 'eco', title: 'Eco Mode', desc: '8s pre-buffer • 256MB cache • Ahorro máximo de batería' },
              ].map((b) => {
                const selected = bufferMode === b.id;
                return (
                  <TouchableOpacity
                    key={b.id}
                    style={[styles.optionCard, selected && styles.optionCardSelected]}
                    onPress={() => onSelectBufferMode(b.id as any)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.optionTitle, selected && { color: '#818cf8' }]}>{b.title}</Text>
                      <Text style={styles.optionDesc}>{b.desc}</Text>
                    </View>
                    {selected && <Check size={20} color="#818cf8" />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ======================= MODAL DE APARIENCIA Y TEMAS ======================= */}
      <Modal
        visible={activeModal === 'appearance'}
        transparent
        animationType="slide"
        onRequestClose={() => setActiveModal(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Tema y Colores</Text>
              <TouchableOpacity onPress={() => setActiveModal(null)} style={styles.closeBtn}>
                <X size={20} color="#ffffff" />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
              {THEMES_LIST.map((theme) => {
                const selected = currentTheme === theme.id;
                return (
                  <TouchableOpacity
                    key={theme.id}
                    style={[styles.optionCard, selected && styles.optionCardSelected]}
                    onPress={() => {
                      onSelectTheme(theme.id);
                    }}
                  >
                    <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: theme.color || '#fff', marginRight: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' }} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.optionTitle, selected && { color: '#60a5fa' }]}>{theme.name}</Text>
                      <Text style={styles.optionDesc}>{theme.desc}</Text>
                    </View>
                    {selected && <Check size={20} color="#60a5fa" />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ======================= MODAL DE OTRO (CACHÉ / AVANZADO) ======================= */}
      <Modal
        visible={activeModal === 'other'}
        transparent
        animationType="slide"
        onRequestClose={() => setActiveModal(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Otras Configuraciones y Caché</Text>
              <TouchableOpacity onPress={() => setActiveModal(null)} style={styles.closeBtn}>
                <X size={20} color="#ffffff" />
              </TouchableOpacity>
            </View>
            <View style={{ paddingVertical: 12 }}>
              <View style={styles.storageBox}>
                <Database size={24} color="#a5b4fc" style={{ marginRight: 14 }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Almacenamiento Offline</Text>
                  <Text style={{ color: '#9ca3af', fontSize: 13, marginTop: 2 }}>Archivos y carátulas cacheadas</Text>
                </View>
                <Text style={{ color: '#818cf8', fontSize: 16, fontWeight: '800' }}>{cacheSize}</Text>
              </View>

              <TouchableOpacity
                style={styles.clearBtn}
                onPress={handleClearCachePress}
                activeOpacity={0.8}
              >
                <Trash2 size={18} color="#ef4444" style={{ marginRight: 8 }} />
                <Text style={{ color: '#ef4444', fontWeight: '700', fontSize: 15 }}>
                  Limpiar Descargas Offline
                </Text>
              </TouchableOpacity>

              <Text style={[styles.sectionHeader, { marginTop: 24 }]}>Herramientas Avanzadas</Text>
              <View style={styles.infoRow}>
                <Text style={{ color: '#d1d5db', fontSize: 14 }}>Forzar resincronización de metadatos ID3</Text>
                <TouchableOpacity style={styles.smallActionBtn} onPress={() => Alert.alert('Listo', 'Metadatos sincronizados correctamente.')}>
                  <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>Ejecutar</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.infoRow}>
                <Text style={{ color: '#d1d5db', fontSize: 14 }}>Optimizar base de datos de audio SQLite</Text>
                <TouchableOpacity style={styles.smallActionBtn} onPress={() => Alert.alert('Listo', 'Base de datos compactada.')}>
                  <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>Optimizar</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* ======================= MODAL DE ACERCA DE ======================= */}
      <Modal
        visible={activeModal === 'about'}
        transparent
        animationType="slide"
        onRequestClose={() => setActiveModal(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Acerca de Milla</Text>
              <TouchableOpacity onPress={() => setActiveModal(null)} style={styles.closeBtn}>
                <X size={20} color="#ffffff" />
              </TouchableOpacity>
            </View>
            <View style={{ paddingVertical: 16 }}>
              <View style={{ alignItems: 'center', marginBottom: 24 }}>
                <Disc size={56} color="#86efac" />
                <Text style={{ color: '#fff', fontSize: 22, fontWeight: '800', marginTop: 12 }}>MILLA HI-RES AUDIO</Text>
                <Text style={{ color: '#9ca3af', fontSize: 14, marginTop: 4 }}>Reproductor y Catálogo Musical Premium</Text>
              </View>

              <View style={styles.infoCard}>
                <View style={styles.infoRowSimple}>
                  <Text style={{ color: '#9ca3af', fontSize: 14 }}>Equipo</Text>
                  <Text style={{ color: '#ffffff', fontSize: 14, fontWeight: '700' }}>Senior Full-Stack</Text>
                </View>
                <View style={styles.infoRowSimple}>
                  <Text style={{ color: '#9ca3af', fontSize: 14 }}>Plataforma</Text>
                  <Text style={{ color: '#ffffff', fontSize: 14, fontWeight: '700' }}>Expo Native Core</Text>
                </View>
                <View style={styles.infoRowSimple}>
                  <Text style={{ color: '#9ca3af', fontSize: 14 }}>Motor de Audio</Text>
                  <Text style={{ color: '#ffffff', fontSize: 14, fontWeight: '700' }}>ExoPlayer / AVFoundation</Text>
                </View>
                <View style={[styles.infoRowSimple, { borderBottomWidth: 0 }]}>
                  <Text style={{ color: '#9ca3af', fontSize: 14 }}>Versión</Text>
                  <Text style={{ color: '#86efac', fontSize: 14, fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' }}>v1.0.0 Stable</Text>
                </View>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* ======================= MODAL DE NOTIFICACIÓN ======================= */}
      <Modal
        visible={activeModal === 'notification'}
        transparent
        animationType="slide"
        onRequestClose={() => setActiveModal(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Estilo de Notificación Local</Text>
              <TouchableOpacity onPress={() => setActiveModal(null)} style={styles.closeBtn}>
                <X size={20} color="#ffffff" />
              </TouchableOpacity>
            </View>
            <View style={{ paddingVertical: 16 }}>
              <View style={styles.optionCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.optionTitle}>Alertas en Segundo Plano sin Internet</Text>
                  <Text style={styles.optionDesc}>
                    Utiliza el gestor local del sistema (expo-notifications) para mostrar controles e insignias de reproducción offline.
                  </Text>
                </View>
                <Switch
                  value={notificationEnabled}
                  onValueChange={handleToggleNotification}
                  trackColor={{ false: '#262626', true: '#fde047' }}
                  thumbColor="#FFFFFF"
                />
              </View>
              <View style={{ padding: 14, backgroundColor: 'rgba(253,224,71,0.08)', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(253,224,71,0.2)', marginTop: 8 }}>
                <Text style={{ color: '#fde047', fontSize: 13, fontWeight: '700' }}>Sin Conexión Requerida</Text>
                <Text style={{ color: '#d1d5db', fontSize: 12, marginTop: 4, lineHeight: 18 }}>
                  Milla procesa todas las alertas en segundo plano localmente en tu dispositivo. Al desactivar, la barra de reproducción del sistema y alertas locales se silenciarán de inmediato.
                </Text>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* ======================= MODAL DE RESPALDO Y RESTAURACIÓN ======================= */}
      <Modal
        visible={activeModal === 'backup'}
        transparent
        animationType="slide"
        onRequestClose={() => setActiveModal(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Respaldo y Restauración</Text>
              <TouchableOpacity onPress={() => setActiveModal(null)} style={styles.closeBtn}>
                <X size={20} color="#ffffff" />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
              <Text style={styles.sectionHeader}>Consolidación SQLite Local</Text>
              <View style={{ padding: 14, backgroundColor: '#1c1c1e', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', marginBottom: 16 }}>
                <Text style={{ color: '#e5e7eb', fontSize: 13, lineHeight: 19 }}>
                  Crea y restaura archivos JSON locales dentro de <Text style={{ color: '#67e8f9', fontWeight: '700' }}>/Milla/Backups/</Text> en tu dispositivo, conteniendo tus BPMs calculados, letras .lrc y ajustes de audio.
                </Text>
              </View>

              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
                <TouchableOpacity
                  style={[styles.capsuleBtn, { backgroundColor: '#67e8f9', borderColor: '#67e8f9', paddingVertical: 14 }]}
                  onPress={handleCreateBackup}
                >
                  <Download size={18} color="#000000" style={{ marginBottom: 4 }} />
                  <Text style={{ color: '#000000', fontWeight: '800', fontSize: 13 }}>Crear Respaldo Ahora</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.capsuleBtn, { backgroundColor: '#1c1c1e', borderColor: 'rgba(255,255,255,0.15)', paddingVertical: 14 }]}
                  onPress={() => handleRestoreBackup()}
                >
                  <Upload size={18} color="#67e8f9" style={{ marginBottom: 4 }} />
                  <Text style={{ color: '#67e8f9', fontWeight: '800', fontSize: 13 }}>Restaurar Último</Text>
                </TouchableOpacity>
              </View>

              {backupStatusMsg ? (
                <Text style={{ color: '#a5b4fc', fontSize: 13, fontWeight: '600', textAlign: 'center', marginBottom: 16 }}>
                  {backupStatusMsg}
                </Text>
              ) : null}

              <Text style={[styles.sectionHeader, { marginTop: 10 }]}>Historial de Respaldos Físicos</Text>
              {localBackups.length === 0 ? (
                <Text style={{ color: '#6b7280', fontSize: 13, textAlign: 'center', marginVertical: 20 }}>
                  {Platform.OS === 'web' ? 'En navegador Web el archivo se descarga directamente.' : 'Aún no hay respaldos en la carpeta /Milla/Backups/'}
                </Text>
              ) : (
                localBackups.map((bk) => (
                  <View key={bk.name} style={styles.optionCard}>
                    <FileText size={20} color="#67e8f9" style={{ marginRight: 12 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.optionTitle} numberOfLines={1}>{bk.name}</Text>
                      <Text style={styles.optionDesc}>
                        {bk.size ? `${(bk.size / 1024).toFixed(1)} KB` : 'Archivo SQLite de respaldo'}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => handleRestoreBackup(bk.uri)}
                      style={{ paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#0e7490', borderRadius: 8 }}
                    >
                      <Text style={{ color: '#ffffff', fontWeight: '700', fontSize: 12 }}>Restaurar</Text>
                    </TouchableOpacity>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ======================= MODAL DE PERSONALIZACIÓN ======================= */}
      <Modal
        visible={activeModal === 'customize'}
        transparent
        animationType="slide"
        onRequestClose={() => setActiveModal(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Personalizar Interfaz</Text>
              <TouchableOpacity onPress={() => setActiveModal(null)} style={styles.closeBtn}>
                <X size={20} color="#ffffff" />
              </TouchableOpacity>
            </View>
            <View style={{ paddingVertical: 20, alignItems: 'center' }}>
              <ShieldCheck size={48} color="#5eead4" />
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600', marginTop: 16, textAlign: 'center' }}>
                Ajustes de Interfaz Activos
              </Text>
              <Text style={{ color: '#9ca3af', fontSize: 13, marginTop: 6, textAlign: 'center', lineHeight: 20 }}>
                El reproductor central y barra inferior han sido optimizados con formato Apple Music Glassmorphic en fondo negro puro.
              </Text>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#141414',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 40,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    marginBottom: 16,
  },
  modalTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHeader: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: '#1c1c1e',
    borderRadius: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  optionCardSelected: {
    backgroundColor: 'rgba(99,102,241,0.15)',
    borderColor: '#6366f1',
  },
  optionTitle: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  optionDesc: {
    color: '#9ca3af',
    fontSize: 12,
    marginTop: 3,
  },
  storageBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1c1c1e',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(239,68,68,0.12)',
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
    marginTop: 16,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  smallActionBtn: {
    backgroundColor: '#374151',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  infoCard: {
    backgroundColor: '#1c1c1e',
    borderRadius: 16,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  infoRowSimple: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  capsuleBtn: {
    flex: 1,
    backgroundColor: '#1c1c1e',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  capsuleBtnSelected: {
    backgroundColor: '#B43C12',
    borderColor: '#B43C12',
  },
  capsuleText: {
    color: '#d1d5db',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  capsuleTextSelected: {
    color: '#ffffff',
    fontWeight: '800',
  },
});
