// Mock de react-native-safe-area-context para Web
// Evita el crash de resolución de módulo en Metro cuando se compila para Web

import React from "react";
import { View } from "react-native";

export const SafeAreaProvider = ({ children }: { children: React.ReactNode }) =>
  React.createElement(View, { style: { flex: 1, backgroundColor: "#000" } }, children);

export const SafeAreaView = ({ children, style }: { children: React.ReactNode; style?: any }) =>
  React.createElement(View, { style: [{ flex: 1 }, style] }, children);

export const useSafeAreaInsets = () => ({ top: 0, bottom: 0, left: 0, right: 0 });

export const useSafeAreaFrame = () => ({ x: 0, y: 0, width: 390, height: 844 });

export const SafeAreaInsetsContext = React.createContext({ top: 0, bottom: 0, left: 0, right: 0 });

export const initialWindowMetrics = null;
