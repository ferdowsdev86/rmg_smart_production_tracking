import { useEffect, useRef, useState } from "react";

import { useAuthStore } from "../store/useAuthStore";

export function useCameraAlerts(enabled = true) {
  const [lastAlert, setLastAlert] = useState(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const token = useAuthStore((s) => s.accessToken);

  useEffect(() => {
    if (!enabled || !token) return undefined;

    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${window.location.host}/ws/camera/`;
    const socket = new WebSocket(url);
    wsRef.current = socket;

    socket.onopen = () => setConnected(true);
    socket.onclose = () => setConnected(false);
    socket.onerror = () => setConnected(false);
    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setLastAlert(data);
      } catch {
        setLastAlert({ raw: event.data });
      }
    };

    return () => {
      socket.close();
      wsRef.current = null;
    };
  }, [enabled, token]);

  return { connected, lastAlert };
}
