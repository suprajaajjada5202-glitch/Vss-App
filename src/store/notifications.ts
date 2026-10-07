import { create } from "zustand";

/**
 * Unread-notification count shared between the topbar badge and the inbox, so marking items read
 * updates the badge immediately instead of waiting for a server round trip.
 * `null` means "use the server-rendered value".
 */
type NotificationState = {
  unread: number | null;
  sync: (serverValue: number) => void;
  decrement: () => void;
  clear: () => void;
};

export const useNotificationStore = create<NotificationState>((set) => ({
  unread: null,
  sync: (serverValue) => set({ unread: serverValue }),
  decrement: () => set((s) => ({ unread: Math.max(0, (s.unread ?? 0) - 1) })),
  clear: () => set({ unread: 0 }),
}));
