import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useAuthStore } from "../store/useAuthStore";

/**
 * Live sewing board WebSocket — on quality/production events, invalidate
 * TV board + floor overview + sewing line dashboard queries immediately.
 */
export function useSewingBoardSocket(enabled = true) {
  const queryClient = useQueryClient();
  const token = useAuthStore((s) => s.accessToken);
  const wsRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (!enabled || !token) return undefined;

    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${window.location.host}/ws/sewing-board/`;
    let closed = false;
    let retryTimer = null;
    let socket;

    function invalidateBoards() {
      queryClient.invalidateQueries({ queryKey: ["sewing-tv"] });
      queryClient.invalidateQueries({ queryKey: ["floor-overview"] });
      queryClient.invalidateQueries({ queryKey: ["sewing-line-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["qc-line-totals"] });
    }

    function scheduleRefresh() {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      // Small debounce so a burst of scans collapses into one refetch.
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        invalidateBoards();
      }, 150);
    }

    function connect() {
      if (closed) return;
      socket = new WebSocket(url);
      wsRef.current = socket;

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg?.type === "sewing.board_refresh" || msg?.reason) {
            scheduleRefresh();
          }
        } catch {
          /* ignore non-JSON */
        }
      };

      socket.onclose = () => {
        wsRef.current = null;
        if (!closed) retryTimer = setTimeout(connect, 3000);
      };
    }

    connect();

    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      try {
        socket?.close();
      } catch {
        /* ignore */
      }
      wsRef.current = null;
    };
  }, [enabled, token, queryClient]);
}
