import { useEffect, useRef, useState } from "react";

import { useAuthStore } from "../store/useAuthStore";

export function useLineSocket(lineId, enabled = true) {
  const [lastMessage, setLastMessage] = useState(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const token = useAuthStore((s) => s.accessToken);

  useEffect(() => {
    if (!enabled || !lineId || !token) return undefined;

    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${window.location.host}/ws/line/${lineId}/`;
    const socket = new WebSocket(url);
    wsRef.current = socket;

    socket.onopen = () => setConnected(true);
    socket.onclose = () => setConnected(false);
    socket.onerror = () => setConnected(false);
    socket.onmessage = (event) => {
      try {
        setLastMessage(JSON.parse(event.data));
      } catch {
        setLastMessage({ raw: event.data });
      }
    };

    return () => {
      socket.close();
      wsRef.current = null;
    };
  }, [enabled, lineId, token]);

  return { connected, lastMessage };
}
