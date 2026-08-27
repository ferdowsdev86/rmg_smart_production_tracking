import { Component } from "react";

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error("UI error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-page p-6">
          <div className="max-w-lg rounded-2xl bg-white p-8 shadow-card border border-slate-100">
            <h1 className="text-lg font-semibold text-slate-900">Something went wrong</h1>
            <p className="mt-2 text-sm text-slate-600">
              {this.state.error?.message || "Unexpected error in this view."}
            </p>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white"
                onClick={() => this.setState({ hasError: false, error: null })}
              >
                Try again
              </button>
              <button
                type="button"
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
                onClick={() => {
                  // hard reload: clear caches so the newest app version loads
                  try {
                    if (window.caches?.keys) {
                      caches.keys().then((ks) => ks.forEach((k) => caches.delete(k)));
                    }
                  } catch (e) { /* ignore */ }
                  window.location.replace(window.location.pathname + "?v=" + Date.now());
                }}
              >
                Reload app (clear cache)
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
