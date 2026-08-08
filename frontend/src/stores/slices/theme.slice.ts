import type { StateCreator } from 'zustand'
import type { Theme } from '../types'

export interface ThemeSlice {
  theme: Theme
  setTheme: (theme: Theme) => void
}

export const createThemeSlice: StateCreator<ThemeSlice, [], [], ThemeSlice> = (set) => ({
  theme: 'dark',
  setTheme: (theme) => set({ theme }),
})
