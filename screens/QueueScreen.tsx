import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  StyleSheet,
  FlatList,
  Modal,
  Alert,
} from 'react-native';
import {
  ArrowLeft,
  Menu,
  MoreVertical,
  Trash2,
  Disc,
} from 'lucide-react-native';
import TrackPlayer from 'react-native-track-player';
import { Track } from '../components/PlayerBar';
import { useVertexQueue } from '../services/queue-service';
import { clearQueue } from '../services/audio-service';
import { TrackOptionsModal } from '../components/TrackOptionsModal';

export interface QueueScreenProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTrack?: (track: Track) => void;
  onOpenLyrics?: (track: Track) => void;
}

export const QueueScreen: React.FC<QueueScreenProps> = ({
  isOpen,
  onClose,
  onSelectTrack,
  onOpenLyrics,
}) => {
  const { priorityQueue, autoMixQueue, currentTrack, removeFromQueue, playNext } = useVertexQueue();
  const [nativeQueue, setNativeQueue] = useState<Track[]>([]);
  const [selectedTrackForOptions, setSelectedTrackForOptions] = useState<Track | null>(null);
  const [isOptionsModalOpen, setIsOptionsModalOpen] = useState<boolean>(false);

  // Sincronizar con TrackPlayer.getQueue()
  useEffect(() => {
    if (!isOpen) return;
    const fetchQueue = async () => {
      try {
        const q = await TrackPlayer.getQueue();
        const activeIdx = await TrackPlayer.getActiveTrackIndex();
        if (q && q.length > 0) {
          const formatted = q.map((t, idx) => ({
            id: String(t.id || idx),
            url: String(t.url || ''),
            title: String(t.title || 'Canción Sin Título'),
            artist: String(t.artist || 'Artista Desconocido'),
            album: String(t.album || 'Milla Hi-Res Library'),
            artwork: t.artwork || undefined,
            artwork_thumb: t.artwork || undefined,
            duration: Number(t.duration || 0),
            isActive: activeIdx === idx,
          }));
          setNativeQueue(formatted);
        } else {
          // Fallback al state de VertexQueue si el reproductor nativo aún no ha cargado una cola completa
          const combined = [
            ...(currentTrack ? [currentTrack] : []),
            ...priorityQueue,
            ...autoMixQueue,
          ].map((t, idx) => ({
            ...t,
            isActive: idx === 0 && !!currentTrack && t.id === currentTrack.id,
          }));
          setNativeQueue(combined as Track[]);
        }
      } catch (e) {
        console.warn('Error fetching native queue in QueueScreen:', e);
      }
    };
    fetchQueue();
    const interval = setInterval(fetchQueue, 2000);
    return () => clearInterval(interval);
  }, [isOpen, priorityQueue, autoMixQueue, currentTrack]);

  if (!isOpen) return null;

  const handleClearQueue = async () => {
    Alert.alert(
      'Borrar cola de reproducción',
      '¿Estás seguro de que deseas vaciar todas las pistas de la cola actual?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Borrar',
          style: 'destructive',
          onPress: async () => {
            await clearQueue();
            setNativeQueue(currentTrack ? [{ ...currentTrack, isActive: true } as Track] : []);
          },
        },
      ]
    );
  };

  const handleRowPress = async (track: Track, index: number) => {
    try {
      if (onSelectTrack) {
        onSelectTrack(track);
      } else {
        await TrackPlayer.skip(index);
        await TrackPlayer.play();
      }
      onClose();
    } catch (e) {
      console.warn('Error saltando a pista en cola:', e);
    }
  };

  const handleOpenOptions = (track: Track) => {
    setSelectedTrackForOptions(track);
    setIsOptionsModalOpen(true);
  };

  const totalDurationSeconds = nativeQueue.reduce((acc, t) => acc + (t.duration || 0), 0);
  const formatTotalDuration = (secs: number) => {
    const hrs = Math.floor(secs / 3600);
    const mins = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (hrs > 0) {
      return `${hrs}:${mins < 10 ? '0' : ''}${mins}:${s < 10 ? '0' : ''}${s}`;
    }
    return `${mins}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <Modal
      visible={isOpen}
      animationType="slide"
      transparent={false}
      onRequestClose={onClose}
    >
      <View style={StyleSheet.absoluteFill} className="bg-black pt-12 pb-6 px-4">
        {/* Cabecera Superior */}
        <View className="flex-row items-center justify-between pb-4 border-b border-white/10 mb-2">
          <TouchableOpacity
            onPress={onClose}
            hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
            className="w-10 h-10 rounded-full bg-neutral-900 items-center justify-center border border-white/10"
          >
            <ArrowLeft size={22} color="#ffffff" />
          </TouchableOpacity>

          <View className="items-center flex-1 mx-4">
            <Text className="text-xl font-bold text-white tracking-tight">
              Cola de reproducción actual
            </Text>
            <Text className="text-xs font-semibold text-neutral-400 mt-0.5">
              A continuación • {nativeQueue.length} {nativeQueue.length === 1 ? 'canción' : 'canciones'} ({formatTotalDuration(totalDurationSeconds)})
            </Text>
          </View>

          <View className="w-10" />
        </View>

        {/* Lista de Canciones en la Cola */}
        {nativeQueue.length === 0 ? (
          <View className="flex-1 items-center justify-center px-6">
            <Disc size={48} color="rgba(255,255,255,0.2)" />
            <Text className="text-base font-bold text-neutral-400 mt-4 text-center">
              La cola de reproducción está vacía
            </Text>
            <Text className="text-xs text-neutral-600 mt-1 text-center">
              Las próximas canciones y recomendaciones de MillaSmartDJ aparecerán aquí.
            </Text>
          </View>
        ) : (
          <FlatList
            data={nativeQueue}
            keyExtractor={(item, idx) => `${item.id}-${idx}`}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 120 }}
            renderItem={({ item, index }) => {
              const isActive = (item as any).isActive || (currentTrack && currentTrack.id === item.id && index === 0);
              const imageUrl = item.artwork_thumb || item.artwork;

              return (
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => handleRowPress(item, index)}
                  className={`flex-row items-center py-3 px-2 border-b border-white/5 rounded-xl ${
                    isActive ? 'bg-white/10 border border-white/10' : ''
                  }`}
                >
                  {/* Barras Horizontales de Arrastre (Drag Handle) */}
                  <View className="pr-3 pl-1 justify-center items-center">
                    <Menu size={20} color="#737373" />
                  </View>

                  {/* Carátula Pequeña */}
                  <View className="w-12 h-12 rounded-lg bg-neutral-800 overflow-hidden border border-white/10 mr-3.5 items-center justify-center">
                    {imageUrl ? (
                      <Image source={{ uri: imageUrl }} className="w-full h-full" resizeMode="cover" />
                    ) : (
                      <Disc size={20} color="#737373" />
                    )}
                  </View>

                  {/* Título en blanco y Artista en gris */}
                  <View className="flex-1 justify-center mr-2">
                    <Text
                      numberOfLines={1}
                      className={`text-base tracking-tight ${
                        isActive ? 'font-black text-[#ea580c]' : 'font-semibold text-white'
                      }`}
                    >
                      {item.title || 'Canción Sin Título'}
                    </Text>
                    <Text numberOfLines={1} className="text-sm font-medium text-neutral-400 mt-0.5">
                      {item.artist || 'Artista Desconocido'}
                    </Text>
                  </View>

                  {/* Botón de tres puntos a la derecha */}
                  <TouchableOpacity
                    onPress={() => handleOpenOptions(item)}
                    hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
                    className="p-2 justify-center items-center"
                  >
                    <MoreVertical size={20} color="#a3a3a3" />
                  </TouchableOpacity>
                </TouchableOpacity>
              );
            }}
          />
        )}

        {/* Botón Flotante Ovalado "Borrar cola" ('bg-sky-200' con texto negro) */}
        {nativeQueue.length > 0 && (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={handleClearQueue}
            style={styles.floatingButton}
            className="flex-row items-center gap-2.5 px-6 py-3.5 rounded-full bg-sky-200 border border-sky-300 shadow-2xl absolute bottom-8 right-6"
          >
            <Trash2 size={18} color="#000000" />
            <Text className="text-sm font-black text-black tracking-wide uppercase">
              Borrar cola
            </Text>
          </TouchableOpacity>
        )}

        {/* Modal de Opciones Integrado */}
        <TrackOptionsModal
          visible={isOptionsModalOpen}
          track={selectedTrackForOptions}
          onClose={() => setIsOptionsModalOpen(false)}
          onPlayNext={(track) => {
            playNext(track as any);
            setIsOptionsModalOpen(false);
          }}
        />
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  floatingButton: {
    shadowColor: '#38bdf8',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 12,
  },
});
