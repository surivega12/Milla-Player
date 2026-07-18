import React from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Image,
  ScrollView,
  Alert,
  Share as NativeShare,
} from 'react-native';
import {
  ListPlus,
  ListMinus,
  ListMusic,
  Disc,
  Share,
  Info,
  Play,
  FileText,
} from 'lucide-react-native';
import { Track } from './PlayerBar';
import { globalVertexQueueManager } from '../services/queue-service';

export interface TrackOptionsModalProps {
  visible: boolean;
  track: Track | null;
  onClose: () => void;
  onPlayNext?: (track: Track) => void;
  onRemoveFromQueue?: (track: Track) => void;
  onGoToLyrics?: (track: Track) => void;
}

export const TrackOptionsModal: React.FC<TrackOptionsModalProps> = ({
  visible,
  track,
  onClose,
  onPlayNext,
  onRemoveFromQueue,
  onGoToLyrics,
}) => {
  if (!track) return null;

  const imageUrl = track.artwork_thumb || track.artwork;
  const ICON_COLOR = '#ea580c'; // Naranja quemado / Rojo oscuro

  // Acciones conectadas
  const handlePlayNext = () => {
    try {
      if (onPlayNext) {
        onPlayNext(track);
      } else {
        // Asumiendo que playNext inyecta la canción a continuación
        globalVertexQueueManager.playNext(track as any);
      }
      onClose();
    } catch (error) {
      console.error('Error al reproducir siguiente:', error);
    }
  };

  const handleAddToQueue = () => {
    try {
      globalVertexQueueManager.addToQueue(track as any);
      onClose();
    } catch (error) {
      console.error('Error al agregar a la cola:', error);
    }
  };

  const handleRemoveFromQueue = () => {
    try {
      if (onRemoveFromQueue) {
        onRemoveFromQueue(track);
      } else {
        globalVertexQueueManager.removeFromQueue(track.id);
      }
      onClose();
    } catch (error) {
      console.error('Error al eliminar de la cola:', error);
    }
  };

  const handleGoToLyrics = () => {
    if (onGoToLyrics) {
      onGoToLyrics(track);
    } else {
      Alert.alert('Letras', 'Abre el reproductor para ver la letra en tiempo real.');
    }
    onClose();
  };

  const handleShare = async () => {
    await NativeShare.share({
      title: track.title,
      message: `${track.title} - ${track.artist}${track.url?.startsWith('http') ? `\n${track.url}` : ''}`,
    });
    onClose();
  };

  const handleDetails = () => {
    const duration = track.duration
      ? `${Math.floor(track.duration / 60)}:${String(Math.floor(track.duration % 60)).padStart(2, '0')}`
      : 'Desconocida';
    Alert.alert(
      'Detalles de la pista',
      `Titulo: ${track.title}\nArtista: ${track.artist}\nAlbum: ${track.album || 'Sin album'}\nDuracion: ${duration}\nCalidad: ${track.qualityBadge || 'Audio local'}\nBPM: ${track.bpm || 'Sin analizar'}\nTonalidad: ${track.camelot_key || track.key || 'Sin analizar'}`
    );
  };

  const renderOption = (icon: React.ReactNode, title: string, onPress: () => void) => (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      className="flex-row items-center gap-4 py-4 px-6 border-b border-white/5"
    >
      <View className="w-6 items-center justify-center">
        {icon}
      </View>
      <Text className="text-base font-medium text-white tracking-tight flex-1">
        {title}
      </Text>
    </TouchableOpacity>
  );

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View className="flex-1 bg-black/60 justify-end">
          <TouchableWithoutFeedback onPress={(e) => e.stopPropagation()}>
            <View className="bg-neutral-900 rounded-t-3xl border-t border-white/10 w-full overflow-hidden pb-8 max-h-[85%]">
              
              {/* Indicador de arrastre (Handle) */}
              <View className="w-full items-center pt-3 pb-1">
                <View className="w-12 h-1.5 rounded-full bg-white/20" />
              </View>

              {/* Cabecera del Modal */}
              <View className="flex-row items-center p-5 border-b border-white/10">
                <View className="w-16 h-16 rounded-xl overflow-hidden bg-neutral-800 relative shadow-lg mr-4 border border-white/10">
                  {imageUrl ? (
                    <Image
                      source={{ uri: imageUrl }}
                      className="w-full h-full"
                      resizeMode="cover"
                    />
                  ) : (
                    <View className="flex-1 items-center justify-center bg-neutral-800">
                      <Disc size={24} color="#9ca3af" />
                    </View>
                  )}
                  {/* Botón Play Superpuesto Translúcido */}
                  <View className="absolute inset-0 items-center justify-center bg-black/30">
                    <View className="w-8 h-8 rounded-full bg-white/20 items-center justify-center backdrop-blur-md">
                      <Play size={14} color="#FFFFFF" fill="#FFFFFF" style={{ marginLeft: 2 }} />
                    </View>
                  </View>
                </View>

                <View className="flex-1 justify-center">
                  <Text className="text-xl font-bold text-white tracking-tight mb-1" numberOfLines={1}>
                    {track.title || 'Canción Sin Título'}
                  </Text>
                  <Text className="text-[15px] font-semibold text-[#ea580c] tracking-tight mb-0.5" numberOfLines={1}>
                    {track.artist || 'Unknown Artist'}
                  </Text>
                  <Text className="text-sm font-medium text-gray-500" numberOfLines={1}>
                    {track.album || 'Sin Álbum'}
                  </Text>
                </View>
              </View>

              {/* Lista de Acciones (Botones) */}
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
                {renderOption(<ListPlus size={22} color={ICON_COLOR} />, 'Reproducir siguiente', handlePlayNext)}
                {renderOption(<ListMusic size={22} color={ICON_COLOR} />, 'Agregar a la cola de reproducción', handleAddToQueue)}
                {renderOption(<ListMinus size={22} color={ICON_COLOR} />, 'Eliminar de la cola de reproducción', handleRemoveFromQueue)}
                {renderOption(<FileText size={22} color={ICON_COLOR} />, 'Ir a la letra', handleGoToLyrics)}
                {renderOption(<Share size={22} color={ICON_COLOR} />, 'Compartir', handleShare)}
                {renderOption(<Info size={22} color={ICON_COLOR} />, 'Detalles', handleDetails)}
              </ScrollView>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};
