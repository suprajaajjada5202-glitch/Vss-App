import { create } from "zustand";

const COLLAPSED_KEY = "vss-sidebar-collapsed";

type UiState = {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebar: (open: boolean) => void;
  /** Desktop only: sidebar shows icons without labels. Remembered per browser. */
  sidebarCollapsed: boolean;
  toggleCollapsed: () => void;
  loadCollapsed: () => void;
};

export const useUiStore = create<UiState>((set, get) => ({
  sidebarOpen: false,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebar: (open) => set({ sidebarOpen: open }),
  sidebarCollapsed: false,
  toggleCollapsed: () => {
    const next = !get().sidebarCollapsed;
    set({ sidebarCollapsed: next });
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      // Storage blocked (private mode etc.): the choice just isn't remembered.
    }
  },
  loadCollapsed: () => {
    try {
      set({ sidebarCollapsed: localStorage.getItem(COLLAPSED_KEY) === "1" });
    } catch {
      // ignore
    }
  },
}));
