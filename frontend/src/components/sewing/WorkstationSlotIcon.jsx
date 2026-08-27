import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import personDeskIcon from "../../assets/person-desk-icon.png";
import {
  FinishingWorkstationHoverCard,
  mergeStationEmployeeMetrics,
} from "./FinishingWorkstationHoverCard";
import { buildPresentEmployees } from "./stationPresent";
import { getStationStatus, stationStatusClasses, stationStatusDot } from "./stationStatus";

const HOVER_CARD_WIDTH = 320;
const HOVER_CARD_HEIGHT = 280;
const HOVER_GAP = 10;
// Cap stacked person icons so a station with many present employees doesn't
// overflow the card with a huge diagonal cascade (the ×N badge shows the total).
const MAX_STACK_ICONS = 3;

function formatStationNo(station) {
  const number = station?.workstationId ?? station?.stationIndex ?? 0;
  return String(number).padStart(2, "0");
}

function computeHoverPosition(rect) {
  const margin = 8;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let left = rect.left + rect.width / 2 - HOVER_CARD_WIDTH / 2;
  left = Math.max(margin, Math.min(left, viewportWidth - HOVER_CARD_WIDTH - margin));

  const spaceBelow = viewportHeight - rect.bottom - HOVER_GAP;
  const spaceAbove = rect.top - HOVER_GAP;
  let top =
    spaceBelow >= HOVER_CARD_HEIGHT || spaceBelow >= spaceAbove
      ? rect.bottom + HOVER_GAP
      : rect.top - HOVER_CARD_HEIGHT - HOVER_GAP;

  top = Math.max(margin, Math.min(top, viewportHeight - HOVER_CARD_HEIGHT - margin));

  return { left, top };
}

function WorkstationHoverPortal({ anchor, station, processMeta, onStayOpen, onRequestClose }) {
  const [position, setPosition] = useState(() => computeHoverPosition(anchor.getBoundingClientRect()));

  useEffect(() => {
    const updatePosition = () => {
      if (!anchor.isConnected) {
        onRequestClose();
        return;
      }
      setPosition(computeHoverPosition(anchor.getBoundingClientRect()));
    };

    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);

    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [anchor, onRequestClose]);

  return createPortal(
    <div
      className="fixed z-[5000]"
      style={{ left: position.left, top: position.top, width: HOVER_CARD_WIDTH }}
      onMouseEnter={onStayOpen}
      onMouseLeave={onRequestClose}
    >
      <FinishingWorkstationHoverCard station={station} processMeta={processMeta} />
    </div>,
    document.body,
  );
}

export function WorkstationSlotIcon({ station, overview = false, compact = false, processMeta = null }) {
  const [hoverTarget, setHoverTarget] = useState(null);
  const hideTimer = useRef(null);
  const presentEmployees = useMemo(() => buildPresentEmployees(station), [station]);
  const hoverStation = useMemo(() => {
    if (presentEmployees.length >= 1) {
      return mergeStationEmployeeMetrics(station, presentEmployees[0]);
    }
    return station;
  }, [station, presentEmployees]);

  const stationNo = formatStationNo(station);
  const status = getStationStatus(station);
  const multi = presentEmployees.length > 1;
  const visibleEmployees = useMemo(
    () => presentEmployees.slice(0, MAX_STACK_ICONS),
    [presentEmployees],
  );
  const iconSize = compact ? (overview ? 42 : 48) : overview ? 44 : 52;
  const stepX = compact ? (overview ? 11 : 12) : overview ? 12 : 14;
  const stepY = compact ? (overview ? 7 : 8) : overview ? 8 : 10;
  const stackWidth = visibleEmployees.length <= 1 ? iconSize : iconSize + (visibleEmployees.length - 1) * stepX;
  const stackHeight =
    visibleEmployees.length <= 1 ? iconSize : iconSize + (visibleEmployees.length - 1) * stepY;
  const isQuietStatus = status.variant === "empty" || status.variant === "idle";

  const clearHideTimer = useCallback(() => {
    if (hideTimer.current) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  const openHover = useCallback(
    (anchor, stationData) => {
      clearHideTimer();
      setHoverTarget({ anchor, station: stationData });
    },
    [clearHideTimer],
  );

  const scheduleClose = useCallback(() => {
    clearHideTimer();
    hideTimer.current = window.setTimeout(() => setHoverTarget(null), 120);
  }, [clearHideTimer]);

  const bindHover = useCallback(
    (stationData) => ({
      onMouseEnter: (event) => openHover(event.currentTarget, stationData),
      onMouseLeave: scheduleClose,
      onFocus: (event) => openHover(event.currentTarget, stationData),
      onBlur: scheduleClose,
    }),
    [openHover, scheduleClose],
  );

  useEffect(() => () => clearHideTimer(), [clearHideTimer]);

  const statusBadge = (
    <span
      className={[
        "inline-flex items-center gap-0.5 rounded-full px-1 py-0.5 ring-1 ring-inset",
        compact ? "text-[10px]" : "text-[11px]",
        isQuietStatus ? "font-semibold" : "font-bold",
        stationStatusClasses(status.variant),
      ].join(" ")}
    >
      <span className={stationStatusDot(status.variant)} aria-hidden>
        {isQuietStatus ? "○" : "●"}
      </span>
      {status.label}
    </span>
  );

  return (
    <>
      <div
        className={[
          "relative flex flex-col items-center",
          compact ? "h-[5.35rem] w-[4.25rem] justify-end gap-0.5" : "w-[4.75rem] gap-1.5",
        ].join(" ")}
      >
        {statusBadge}

        <div
          className="relative flex items-center justify-center"
          style={{
            width: stackWidth,
            height: Math.max(stackHeight, iconSize),
          }}
        >
          {visibleEmployees.length > 0 ? (
            visibleEmployees.map((employee, index) => {
              const employeeId = employee?.present_employee_id || employee?.event_employee_id || `idx-${index}`;
              const employeeStation = mergeStationEmployeeMetrics(station, employee);

              return (
                <div
                  key={employeeId}
                  className={[
                    "absolute bg-transparent p-0",
                    multi ? "relative" : "",
                  ].join(" ")}
                  style={{
                    left: index * stepX,
                    top: index * stepY,
                    zIndex: index + 1,
                    width: iconSize,
                    height: iconSize,
                  }}
                  {...bindHover(employeeStation)}
                >
                  <img
                    src={personDeskIcon}
                    alt=""
                    tabIndex={0}
                    className="h-full w-full cursor-pointer object-contain drop-shadow-[0_2px_4px_rgba(15,23,42,0.22)] contrast-[1.12] saturate-[1.08] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                    draggable={false}
                  />
                </div>
              );
            })
          ) : (
            <div
              className="flex flex-col items-center justify-center rounded border border-dashed border-slate-200 bg-slate-50/80 px-1 text-center"
              style={{ width: iconSize, height: iconSize }}
              {...bindHover(hoverStation)}
            >
              <span className="text-[9px] font-semibold leading-tight text-slate-500">
                {status.variant === "idle" ? "Idle" : "Absent"}
              </span>
            </div>
          )}

          {multi ? (
            <span className="pointer-events-none absolute -right-1 -top-1 z-[110] rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-extrabold text-white shadow-md">
              ×{presentEmployees.length}
            </span>
          ) : null}
        </div>

        <span
          className={[
            "text-center font-bold tabular-nums text-slate-600",
            compact ? "text-[10px]" : overview ? "text-[11px]" : "text-xs",
          ].join(" ")}
        >
          Stn {stationNo}
        </span>
      </div>

      {hoverTarget ? (
        <WorkstationHoverPortal
          anchor={hoverTarget.anchor}
          station={hoverTarget.station}
          processMeta={processMeta}
          onStayOpen={clearHideTimer}
          onRequestClose={scheduleClose}
        />
      ) : null}
    </>
  );
}
