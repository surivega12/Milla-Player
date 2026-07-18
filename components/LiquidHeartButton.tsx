import React, { useEffect, useRef } from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import Svg, {
  ClipPath,
  Defs,
  LinearGradient,
  Path,
  Stop,
} from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

const HEART_PATH = 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z';
const AnimatedPath = Animated.createAnimatedComponent(Path);

interface LiquidHeartButtonProps {
  liked: boolean;
  onPress?: () => void;
  size?: number;
  inactiveColor?: string;
  accessibilityLabel?: string;
}

export const LiquidHeartButton: React.FC<LiquidHeartButtonProps> = ({
  liked,
  onPress,
  size = 22,
  inactiveColor = '#9ca3af',
  accessibilityLabel = 'Me encanta',
}) => {
  const ids = useRef(`heart-${Math.random().toString(36).slice(2, 9)}`).current;
  const hasMounted = useRef(false);
  const previousLiked = useRef(liked);
  const fillLevel = useSharedValue(liked ? 1 : 0);
  const wavePhase = useSharedValue(0);
  const crackOpacity = useSharedValue(0);
  const scale = useSharedValue(1);

  useEffect(() => {
    wavePhase.value = withRepeat(
      withTiming(Math.PI * 2, { duration: 1150, easing: Easing.linear }),
      -1,
      false
    );
  }, [wavePhase]);

  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true;
      previousLiked.current = liked;
      fillLevel.value = liked ? 1 : 0;
      crackOpacity.value = 0;
      return;
    }
    if (previousLiked.current === liked) return;
    previousLiked.current = liked;
    if (liked) {
      crackOpacity.value = 0;
      fillLevel.value = withTiming(1, { duration: 720, easing: Easing.out(Easing.cubic) });
      scale.value = withSequence(
        withTiming(1.18, { duration: 160 }),
        withTiming(1, { duration: 280, easing: Easing.out(Easing.back(1.5)) })
      );
    } else {
      crackOpacity.value = withSequence(
        withTiming(1, { duration: 110 }),
        withDelay(190, withTiming(0, { duration: 260 }))
      );
      fillLevel.value = withDelay(90, withTiming(0, { duration: 480, easing: Easing.in(Easing.cubic) }));
      scale.value = withSequence(
        withTiming(0.88, { duration: 130 }),
        withTiming(1.08, { duration: 120 }),
        withTiming(1, { duration: 180 })
      );
    }
  }, [liked, crackOpacity, fillLevel, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const liquidProps = useAnimatedProps(() => {
    const top = 26 - fillLevel.value * 29;
    const amplitude = fillLevel.value > 0.01 && fillLevel.value < 0.99 ? 1.15 : 0.65;
    const y0 = top + Math.sin(wavePhase.value) * amplitude;
    const y1 = top + Math.sin(wavePhase.value + Math.PI / 2) * amplitude;
    const y2 = top + Math.sin(wavePhase.value + Math.PI) * amplitude;
    const y3 = top + Math.sin(wavePhase.value + (Math.PI * 3) / 2) * amplitude;
    return {
      d: `M -2 ${y0} Q 2 ${y1} 6 ${y2} T 14 ${y3} T 26 ${y0} L 26 27 L -2 27 Z`,
    };
  });

  const crackProps = useAnimatedProps(() => ({ opacity: crackOpacity.value }));

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={0.72}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: liked }}
      style={[styles.touchTarget, { width: size + 18, height: size + 18 }]}
    >
      <Animated.View style={animatedStyle}>
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Defs>
            <ClipPath id={`${ids}-clip`}>
              <Path d={HEART_PATH} />
            </ClipPath>
            <LinearGradient id={`${ids}-fill`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#fb7185" />
              <Stop offset="0.52" stopColor="#ef476f" />
              <Stop offset="1" stopColor="#be123c" />
            </LinearGradient>
          </Defs>
          <Path d={HEART_PATH} fill="transparent" stroke={inactiveColor} strokeWidth={1.8} />
          <AnimatedPath
            animatedProps={liquidProps}
            fill={`url(#${ids}-fill)`}
            clipPath={`url(#${ids}-clip)`}
          />
          <Path d={HEART_PATH} fill="transparent" stroke={liked ? '#fb7185' : inactiveColor} strokeWidth={1.8} />
          <AnimatedPath
            animatedProps={crackProps}
            d="M13.2 3.2 9.8 9.3l4.1 3.1-3.2 8.1"
            fill="none"
            stroke="#f8fafc"
            strokeWidth={1.25}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </Animated.View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  touchTarget: { alignItems: 'center', justifyContent: 'center' },
});
