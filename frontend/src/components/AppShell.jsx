import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  Camera,
  LayoutDashboard,
  LineChart,
  LogOut,
  Map,
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

export function AppShell() {
  const navigate = useNavigate();
  const clearSession = useAuthStore((s) => s.clearSession);
  const username = useAuthStore((s) => s.username);

  function logout() {
    clearSession();
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-screen flex bg-page">
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
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
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
          ))}
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
      <main className="flex-1 min-w-0">
        <div className="md:hidden bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3">
          <img src="/mbm-logo.png" alt="MBM Group" className="h-7 w-auto" />
          <span className="text-sm font-medium">Sewing-Automation (MBM)</span>
        </div>
        <div className="p-4 md:p-8 max-w-7xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
