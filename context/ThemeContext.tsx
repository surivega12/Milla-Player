import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  ReactNode,
} from 'react';
import { getThemeColors, ThemePalette } from '../utils/theme-colors';
import { getThemeSetting, saveThemeSetting } from '../services/database-service';

export interface ThemeContextType {
  currentTheme: string;
  setTheme: (theme: string) => void;
  colors: ThemePalette;
}

const ThemeContext = createContext<ThemeContextType>({
  currentTheme: 'theme-monochrome',
  setTheme: () => {},
  colors: getThemeColors('theme-monochrome'),
});

export interface ThemeProviderProps {
  children: ReactNode;
  initialTheme?: string;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({
  children,
  initialTheme = 'theme-monochrome',
}) => {
  const [currentTheme, setCurrentThemeState] = useState<string>(initialTheme);

  useEffect(() => {
    let isMounted = true;
    async function loadStoredTheme() {
      try {
        const stored = await getThemeSetting();
        if (isMounted && stored) {
          setCurrentThemeState(stored);
        }
      } catch (err) {
        console.error('[ThemeContext] Error al cargar el tema desde SQLite:', err);
      }
    }
    loadStoredTheme();
    return () => {
      isMounted = false;
    };
  }, []);

  const setTheme = useCallback(async (newTheme: string) => {
    let themeKey = newTheme;
    if (!themeKey.startsWith('theme-')) {
      themeKey = `theme-${themeKey.toLowerCase()}`;
    }
    setCurrentThemeState(themeKey);
    await saveThemeSetting(themeKey);
  }, []);

  const colors = useMemo(() => {
    return getThemeColors(currentTheme);
  }, [currentTheme]);

  const value = useMemo(
    () => ({
      currentTheme,
      setTheme,
      colors,
    }),
    [currentTheme, setTheme, colors]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme debe ser utilizado dentro de un ThemeProvider');
  }
  return context;
};
