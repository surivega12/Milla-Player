import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { BlurView } from 'expo-blur';
import { AlertTriangle, Sparkles, Zap } from 'lucide-react-native';
import { getCachedTracks } from '../services/database-service';

interface NotificationCardProps {
  tracksNeedingRepair?: number;
  onOptimize?: () => void;
  isOptimizing?: boolean;
  progressText?: string;
}

export const NotificationCard: React.FC<NotificationCardProps> = ({
  tracksNeedingRepair: propCount,
  onOptimize,
  isOptimizing = false,
  progressText,
}) => {
  const [internalCount, setInternalCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    if (propCount !== undefined) {
      setInternalCount(propCount);
      return;
    }

    let isMounted = true;
    const checkTracks = async () => {
      try {
        setLoading(true);
        const tracks = await getCachedTracks();
        const count = tracks.filter(t => (t as any).needs_repair || !(t as any).bpm || !(t as any).key).length;
        if (isMounted) {
          setInternalCount(count);
        }
      } catch (err) {
        console.error('Error al consultar pistas por reparar:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    checkTracks();
    return () => {
      isMounted = false;
    };
  }, [propCount]);

  const count = propCount !== undefined ? propCount : internalCount;

  if (loading && count === 0) {
    return null;
  }

  if (count === 0) {
    return null;
  }

  return (
    <View className="mx-5 mb-6 rounded-3xl overflow-hidden border border-amber-500/40 shadow-2xl bg-amber-950/20">
      <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={StyleSheet.absoluteFill} className="bg-gradient-to-r from-amber-500/10 via-transparent to-amber-500/5" />
      
      <View className="p-5">
        <View className="flex-row items-center justify-between mb-2">
          <View className="flex-row items-center gap-2">
            <View className="w-8 h-8 rounded-full bg-amber-500/20 border border-amber-500/40 items-center justify-center">
              <AlertTriangle size={16} color="#f59e0b" />
            </View>
            <Text className="text-xs font-black tracking-widest text-amber-400 uppercase">
              VERTEX AI OPTIMIZER
            </Text>
          </View>
          <View className="px-2.5 py-1 rounded-full bg-amber-500/20 border border-amber-500/30 flex-row items-center gap-1">
            <Sparkles size={11} color="#f59e0b" />
            <Text className="text-[10px] font-black text-amber-300 uppercase">
              {count} Pista{count !== 1 ? 's' : ''}
            </Text>
          </View>
        </View>

        <Text className="text-base font-black text-white leading-tight mt-1">
          Hemos detectado {count} canci{count !== 1 ? 'ones' : 'ón'} con metadatos incompletos.
        </Text>
        
        <Text className="text-xs text-amber-200/80 font-medium mt-1.5 leading-relaxed">
          ¿Deseas optimizar tu biblioteca offline? El motor acústico de VERTEX calculará BPM, Tono Camelot y puntos de mezcla armónica automáticamente.
        </Text>

        {isOptimizing && progressText ? (
          <Text className="text-xs text-white font-semibold mt-3" numberOfLines={2}>
            {progressText}
          </Text>
        ) : null}

        <TouchableOpacity
          onPress={onOptimize}
          disabled={isOptimizing}
          activeOpacity={0.8}
          className="mt-4 py-3 px-5 rounded-2xl bg-amber-500 items-center justify-center flex-row gap-2 shadow-lg border border-amber-400"
          style={{ opacity: isOptimizing ? 0.7 : 1 }}
        >
          {isOptimizing ? (
            <ActivityIndicator size="small" color="#000000" />
          ) : (
            <Zap size={16} color="#000000" fill="#000000" />
          )}
          <Text className="text-xs font-black uppercase tracking-wider text-black">
            {isOptimizing ? 'Analizando...' : 'Optimizar Ahora'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};
