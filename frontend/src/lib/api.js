import axios from "axios";
import { useAuthStore } from "../store/useAuthStore";

const api = axios.create({
  baseURL: "/api",
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  const path = `${config.baseURL || ""}${config.url || ""}`;
  // Never send a stale Bearer to obtain/refresh JWT — can confuse some proxies or custom auth.
  const isJwtAuth = path.includes("/auth/token");
  if (isJwtAuth) {
    delete config.headers.Authorization;
    return config;
  }
  const token = useAuthStore.getState().accessToken || localStorage.getItem("access_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let refreshPromise = null;

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    const status = error.response?.status;

    if (status !== 401 || !original || original._retry) {
      return Promise.reject(error);
    }

    // Do not retry JWT obtain/refresh failures (avoid loops; wrong password stays 401).
    const path = `${original.baseURL || ""}${original.url || ""}`;
    if (path.includes("/auth/token")) {
      return Promise.reject(error);
    }

    const refresh = useAuthStore.getState().refreshToken || localStorage.getItem("refresh_token");
    if (!refresh) {
      useAuthStore.getState().clearSession();
      if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
        window.location.assign("/login");
      }
      return Promise.reject(error);
    }

    original._retry = true;

    try {
      if (!refreshPromise) {
        refreshPromise = axios
          .post("/api/auth/token/refresh/", { refresh })
          .then((res) => {
            const access = res.data.access;
            const newRefresh = res.data.refresh;
            useAuthStore.getState().setSession({
              access,
              refresh: newRefresh ?? refresh,
            });
            return access;
          })
          .finally(() => {
            refreshPromise = null;
          });
      }

      const access = await refreshPromise;
      original.headers.Authorization = `Bearer ${access}`;
      return api(original);
    } catch {
      useAuthStore.getState().clearSession();
      if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
        window.location.assign("/login");
      }
      return Promise.reject(error);
    }
  }
);

export default api;
