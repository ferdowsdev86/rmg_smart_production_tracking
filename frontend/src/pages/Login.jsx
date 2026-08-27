import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../lib/api";
import { useAuthStore } from "../store/useAuthStore";

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const setSession = useAuthStore((s) => s.setSession);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const from = location.state?.from?.pathname || "/";

  async function onSubmit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post("/auth/token/", { username, password });
      setSession({ access: data.access, refresh: data.refresh, username });
      toast.success("Signed in");
      navigate(from, { replace: true });
    } catch (err) {
      if (!err.response) {
        toast.error(
          "Cannot reach the API. Start the backend: cd backend && python manage.py runserver"
        );
      } else {
        const body = err.response?.data;
        let message = body?.detail;
        if (!message && body && typeof body === "object") {
          const parts = [];
          for (const [key, val] of Object.entries(body)) {
            if (Array.isArray(val)) parts.push(`${key}: ${val.join(" ")}`);
            else if (typeof val === "string") parts.push(`${key}: ${val}`);
          }
          message = parts.join(" · ") || null;
        }
        toast.error(message || "Invalid username/email or password");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-page px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-card border border-slate-100">
        <div className="flex justify-center mb-5">
          <img src="/mbm-logo-md.png" alt="MBM Group" className="h-20 w-auto" />
        </div>
        <h1 className="text-xl font-semibold text-slate-900 text-center">Sewing-Automation (MBM)</h1>
        <p className="mt-1 text-sm text-slate-600 text-center">
          Sign in with your username or email.
        </p>
        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <div>
            <label className="block text-xs font-medium text-slate-600">Username or email</label>
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Password</label>
            <input
              type="password"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-primary py-2.5 text-sm font-medium text-white disabled:opacity-60"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
