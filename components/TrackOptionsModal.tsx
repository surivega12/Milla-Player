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
} from 'react-native';
import {
  ListPlus,
  ListMinus,
  ListMusic,
  FolderPlus,
  Disc,
  Mic,
  Share,
  Tag,
  Info,
  Bell,
  Ban,
  Trash2,
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


  const handleNotImplemented = (featureName: string) => {
    Alert.alert('En desarrollo', `La función "${featureName}" estará disponible próximamente.`);
    onClose();
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
                {renderOption(<FolderPlus size={22} color={ICON_COLOR} />, 'Agregar a playlist', () => handleNotImplemented('Agregar a playlist'))}
                {renderOption(<Disc size={22} color={ICON_COLOR} />, 'Ir al álbum', () => handleNotImplemented('Ir al álbum'))}
                {renderOption(<Mic size={22} color={ICON_COLOR} />, 'Ir al artista', () => handleNotImplemented('Ir al artista'))}
                {renderOption(<Share size={22} color={ICON_COLOR} />, 'Compartir', () => handleNotImplemented('Compartir'))}
                {renderOption(<Tag size={22} color={ICON_COLOR} />, 'Editor de etiquetas', () => handleNotImplemented('Editor de etiquetas'))}
                {renderOption(<Info size={22} color={ICON_COLOR} />, 'Detalles', () => handleNotImplemented('Detalles'))}
                {renderOption(<Bell size={22} color={ICON_COLOR} />, 'Establecer como tono de llamada', () => handleNotImplemented('Establecer como tono de llamada'))}
                {renderOption(<Ban size={22} color={ICON_COLOR} />, 'Agregar a la lista negra', () => handleNotImplemented('Agregar a la lista negra'))}
                {renderOption(<Trash2 size={22} color={ICON_COLOR} />, 'Eliminar del dispositivo', () => handleNotImplemented('Eliminar del dispositivo'))}
              </ScrollView>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};
