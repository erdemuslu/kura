import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';

export type FavoriteMediaType = 'song' | 'movie' | 'series';

export interface FavoriteItem {
  id: string;
  mediaType: FavoriteMediaType;
  title: string;
  subtitle?: string;
  meta?: string;
  posterUrl?: string;
  createdAt: number;
}

interface FavoritesContextType {
  favorites: FavoriteItem[];
  isFavorite: (id: string) => boolean;
  toggleFavorite: (item: Omit<FavoriteItem, 'createdAt'>) => void;
  removeFavorite: (id: string) => void;
  getFavoritesByType: (type: FavoriteMediaType) => FavoriteItem[];
  importFavorites: (items: FavoriteItem[], mode?: 'merge' | 'replace') => void;
  setFavorites: React.Dispatch<React.SetStateAction<FavoriteItem[]>>;
}

const STORAGE_KEY = 'kura-favorites';

const FavoritesContext = createContext<FavoritesContextType | null>(null);

export function FavoritesProvider({ children }: { children: React.ReactNode }) {
  const [favorites, setFavorites] = useState<FavoriteItem[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites));
    } catch (e) {
      console.error('Failed to save favorites to localStorage', e);
    }
  }, [favorites]);

  const favoriteIds = useMemo(() => new Set(favorites.map((f) => f.id)), [favorites]);

  const isFavorite = (id: string) => favoriteIds.has(id);

  const toggleFavorite = (item: Omit<FavoriteItem, 'createdAt'>) => {
    setFavorites((prev) => {
      const exists = prev.some((f) => f.id === item.id);
      if (exists) {
        return prev.filter((f) => f.id !== item.id);
      }
      return [{ ...item, createdAt: Date.now() }, ...prev];
    });
  };

  const removeFavorite = (id: string) => {
    setFavorites((prev) => prev.filter((f) => f.id !== id));
  };

  const getFavoritesByType = (type: FavoriteMediaType) => {
    return favorites.filter((f) => f.mediaType === type);
  };

  const importFavorites = (items: FavoriteItem[], mode: 'merge' | 'replace' = 'merge') => {
    setFavorites((prev) => {
      if (mode === 'replace') return items;
      const existingIds = new Set(prev.map((f) => f.id));
      const newItems = items.filter((f) => !existingIds.has(f.id));
      return [...prev, ...newItems];
    });
  };

  return (
    <FavoritesContext.Provider
      value={{
        favorites,
        isFavorite,
        toggleFavorite,
        removeFavorite,
        getFavoritesByType,
        importFavorites,
        setFavorites,
      }}
    >
      {children}
    </FavoritesContext.Provider>
  );
}

export function useFavorites() {
  const context = useContext(FavoritesContext);
  if (!context) {
    throw new Error('useFavorites must be used within a FavoritesProvider');
  }
  return context;
}
