import { create } from "zustand";

const STORAGE_ACCESS = "access_token";
const STORAGE_REFRESH = "refresh_token";

export const useAuthStore = create((set, get) => ({
  accessToken: typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_ACCESS) : null,
  refreshToken: typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_REFRESH) : null,
  username: null,
  setSession: ({ access, refresh, username }) => {
    if (access) localStorage.setItem(STORAGE_ACCESS, access);
    if (refresh) localStorage.setItem(STORAGE_REFRESH, refresh);
    set({
      accessToken: access ?? get().accessToken,
      refreshToken: refresh ?? get().refreshToken,
      username: username ?? get().username,
    });
  },
  clearSession: () => {
    localStorage.removeItem(STORAGE_ACCESS);
    localStorage.removeItem(STORAGE_REFRESH);
    set({ accessToken: null, refreshToken: null, username: null });
  },
}));
