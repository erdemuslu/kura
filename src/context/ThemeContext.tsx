import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type ThemeId =
  | 'kura'
  | 'ayu'
  | 'nord'
  | 'dracula'
  | 'catppuccin'
  | 'tokyo-night'
  | 'gruvbox'
  | 'oled';

export interface ThemeDefinition {
  id: ThemeId;
  nameKey: string;
  descKey: string;
  preview: {
    bg: string;
    surface: string;
    text: string;
    accent: string;
  };
}

export const THEMES: ThemeDefinition[] = [
  {
    id: 'kura',
    nameKey: 'settings.themes.kura',
    descKey: 'settings.themes.kuraDesc',
    preview: {
      bg: '#171514',
      surface: '#221f1e',
      text: '#f3f1ee',
      accent: '#e5ad58',
    },
  },
  {
    id: 'ayu',
    nameKey: 'settings.themes.ayu',
    descKey: 'settings.themes.ayuDesc',
    preview: {
      bg: '#0b0e14',
      surface: '#131721',
      text: '#cbccc6',
      accent: '#ffb454',
    },
  },
  {
    id: 'nord',
    nameKey: 'settings.themes.nord',
    descKey: 'settings.themes.nordDesc',
    preview: {
      bg: '#242933',
      surface: '#2e3440',
      text: '#eceff4',
      accent: '#88c0d0',
    },
  },
  {
    id: 'dracula',
    nameKey: 'settings.themes.dracula',
    descKey: 'settings.themes.draculaDesc',
    preview: {
      bg: '#1e1f29',
      surface: '#282a36',
      text: '#f8f8f2',
      accent: '#bd93f9',
    },
  },
  {
    id: 'catppuccin',
    nameKey: 'settings.themes.catppuccin',
    descKey: 'settings.themes.catppuccinDesc',
    preview: {
      bg: '#181825',
      surface: '#1e1e2e',
      text: '#cdd6f4',
      accent: '#cba6f7',
    },
  },
  {
    id: 'tokyo-night',
    nameKey: 'settings.themes.tokyoNight',
    descKey: 'settings.themes.tokyoNightDesc',
    preview: {
      bg: '#16161e',
      surface: '#1a1b26',
      text: '#c0caf5',
      accent: '#7aa2f7',
    },
  },
  {
    id: 'gruvbox',
    nameKey: 'settings.themes.gruvbox',
    descKey: 'settings.themes.gruvboxDesc',
    preview: {
      bg: '#1d2021',
      surface: '#282828',
      text: '#ebdbb2',
      accent: '#fe8019',
    },
  },
  {
    id: 'oled',
    nameKey: 'settings.themes.oled',
    descKey: 'settings.themes.oledDesc',
    preview: {
      bg: '#000000',
      surface: '#0e0e0e',
      text: '#ffffff',
      accent: '#f59e0b',
    },
  },
];

export const THEME_STORAGE_KEY = 'kura-theme';
export const DEFAULT_THEME: ThemeId = 'kura';

interface ThemeContextValue {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
  themes: ThemeDefinition[];
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredTheme(): ThemeId {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved && THEMES.some((t) => t.id === saved)) {
      return saved as ThemeId;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_THEME;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(readStoredTheme);

  const setTheme = useCallback((next: ThemeId) => {
    setThemeState(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      themes: THEMES,
    }),
    [theme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}
