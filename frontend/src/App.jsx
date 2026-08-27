import { Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { AppShell } from "./components/AppShell";
import { ProtectedLayout } from "./components/ProtectedLayout";
import FloorDashboard from "./pages/FloorDashboard";
import LineDiagram from "./pages/LineDiagram";
import LineLayout from "./pages/LineLayout";
import StationView from "./pages/StationView";
import Reports from "./pages/Reports";
import StationSetup from "./pages/StationSetup";
import CameraMonitor from "./pages/CameraMonitor";
import Settings from "./pages/Settings";
import MachinManpowerLayout from "./pages/MachinManpowerLayout";
import MachineList from "./pages/MachineList";
import MachineryDashboard from "./pages/MachineryDashboard";
import DailyMachineMaintenance from "./pages/DailyMachineMaintenance";
import DailyNptList from "./pages/DailyNptList";
import SewingLineDashboard from "./pages/SewingLineDashboard";
import SewingTvBoard from "./pages/SewingTvBoard";
import QualityCheck from "./pages/QualityCheck";
import Login from "./pages/Login";

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<ProtectedLayout />}>
          <Route element={<AppShell />}>
            <Route index element={<FloorDashboard />} />
            <Route path="lines" element={<LineDiagram />} />
            <Route path="line-layout" element={<LineLayout />} />
            <Route path="machin-manpower-layout" element={<MachinManpowerLayout />} />
            <Route path="machinery-dashboard" element={<MachineryDashboard />} />
            <Route path="machine-list" element={<MachineList />} />
            <Route path="machine-maintenance" element={<DailyMachineMaintenance />} />
            <Route path="daily-npt" element={<DailyNptList />} />
            <Route path="stations" element={<StationView />} />
            <Route path="setup" element={<StationSetup />} />
            <Route path="sewing-line" element={<SewingLineDashboard />} />
            <Route path="sewing-tv" element={<SewingTvBoard />} />
            <Route path="camera" element={<CameraMonitor />} />
            <Route path="quality-check" element={<QualityCheck />} />
            <Route path="reports" element={<Reports />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster position="top-right" />
    </>
  );
}
