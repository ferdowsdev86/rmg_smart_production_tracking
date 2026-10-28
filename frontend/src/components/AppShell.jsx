import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Camera,
  LayoutDashboard,
  LineChart,
  LogOut,
  Map,
  Menu,
  Settings,
  SlidersHorizontal,
  LayoutGrid,
  ListTree,
  Workflow,
  Users,
  Wrench,
  ClipboardList,
  Cog,
  AlertOctagon,
  BadgeCheck,
  MonitorPlay,
  X,
} from "lucide-react";
import { useAuthStore } from "../store/useAuthStore";

const nav = [
  { to: "/", label: "Floor Dashboard", icon: LayoutDashboard },
  { to: "/lines", label: "Finishing Line", icon: Map },
  { to: "/line-layout", label: "Line Layout", icon: ListTree },
  { to: "/machin-manpower-layout", label: "Machin assign as per layout", icon: Users },
  { to: "/machinery-dashboard", label: "Machinery Dashboard", icon: Cog },
  { to: "/machine-list", label: "Machine List", icon: Wrench },
  { to: "/machine-maintenance", label: "Machine Maintenance", icon: ClipboardList },
  { to: "/daily-npt", label: "Daily NPT List", icon: AlertOctagon },
  { to: "/sewing-line", label: "Sewing Line", icon: Workflow },
  { to: "/sewing-tv", label: "Sewing TV Board", icon: MonitorPlay },
  { to: "/stations", label: "Station View", icon: LayoutGrid },
  { to: "/setup", label: "Station Setup", icon: SlidersHorizontal },
  { to: "/camera", label: "Camera Monitor", icon: Camera },
  { to: "/quality-check", label: "Quality Check", icon: BadgeCheck },
  { to: "/reports", label: "Reports", icon: LineChart },
  { to: "/settings", label: "Settings", icon: Settings },
];

// quick-access tabs pinned to the bottom bar on phones
const bottomNav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/quality-check", label: "Quality", icon: BadgeCheck },
  { to: "/reports", label: "Reports", icon: LineChart },
  { to: "/daily-npt", label: "NPT", icon: AlertOctagon },
];

function NavItems({ onNavigate }) {
  return nav.map((item) => (
    <NavLink
      key={item.to}
      to={item.to}
      end={item.to === "/"}
      onClick={onNavigate}
      className={({ isActive }) =>
        [
          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
          isActive ? "bg-slate-700 text-white" : "text-slate-300 hover:bg-slate-800",
        ].join(" ")
      }
    >
      <item.icon className="h-4 w-4" />
      {item.label}
    </NavLink>
  ));
}

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const clearSession = useAuthStore((s) => s.clearSession);
  const username = useAuthStore((s) => s.username);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // close the mobile drawer on every route change
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  function logout() {
    clearSession();
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-screen flex bg-page">
      {/* desktop sidebar */}
      <aside className="hidden md:flex w-60 flex-col bg-sidebar text-slate-100">
        <div className="px-6 py-5 border-b border-slate-700/60">
          <div className="rounded-lg bg-white px-3 py-2 mb-2 flex justify-center">
            <img src="/mbm-logo.png" alt="MBM Group" className="h-9 w-auto" />
          </div>
          <div className="text-sm font-semibold tracking-tight">Sewing-Automation (MBM)</div>
          <div className="text-xs text-slate-400 mt-1">Operations console</div>
          {username ? <div className="text-xs text-slate-300 mt-2 truncate">{username}</div> : null}
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          <NavItems />
        </nav>
        <div className="p-3 border-t border-slate-700/60">
          <button
            type="button"
            onClick={logout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      {/* mobile slide-in drawer */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-slate-900/60" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-sidebar text-slate-100 shadow-2xl">
            <div className="flex items-center justify-between gap-2 border-b border-slate-700/60 px-4 py-4">
              <div className="flex items-center gap-2 min-w-0">
                <div className="rounded-md bg-white px-2 py-1">
                  <img src="/mbm-logo.png" alt="MBM Group" className="h-7 w-auto" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">Sewing-Automation</div>
                  {username ? <div className="truncate text-[11px] text-slate-400">{username}</div> : null}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="rounded-lg p-2 text-slate-300 hover:bg-slate-800"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
              <NavItems onNavigate={() => setDrawerOpen(false)} />
            </nav>
            <div className="border-t border-slate-700/60 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <button
                type="button"
                onClick={logout}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </div>
          </aside>
        </div>
      ) : null}

      <main className="flex-1 min-w-0">
        {/* mobile top bar */}
        <div className="md:hidden sticky top-0 z-40 bg-white border-b border-slate-200 px-3 py-2.5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <img src="/mbm-logo.png" alt="MBM Group" className="h-7 w-auto" />
          <span className="truncate text-sm font-semibold text-slate-800">Sewing-Automation</span>
        </div>

        <div className="p-3 pb-24 md:p-8 md:pb-8 max-w-7xl mx-auto">
          <Outlet />
        </div>

        {/* mobile bottom quick nav */}
        <nav className="md:hidden fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
          <div className="grid grid-cols-5">
            {bottomNav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  [
                    "flex flex-col items-center gap-0.5 py-2 text-[10px] font-semibold",
                    isActive ? "text-blue-700" : "text-slate-500",
                  ].join(" ")
                }
              >
                <item.icon className="h-5 w-5" />
                {item.label}
              </NavLink>
            ))}
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="flex flex-col items-center gap-0.5 py-2 text-[10px] font-semibold text-slate-500"
            >
              <Menu className="h-5 w-5" />
              Menu
            </button>
          </div>
        </nav>
      </main>
    </div>
  );
}
