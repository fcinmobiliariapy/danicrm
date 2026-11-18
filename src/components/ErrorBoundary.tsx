import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let displayMessage = error?.message || 'Ha ocurrido un error inesperado.';
    try {
      const parsed = JSON.parse(displayMessage);
      if (parsed && typeof parsed.error === 'string' && parsed.operationType) {
        displayMessage = `Error de acceso a Firestore (${parsed.operationType} en "${parsed.path || 'raíz'}"): ${parsed.error}`;
      }
    } catch {
      // keep raw message
    }
    return { hasError: true, message: displayMessage };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Application ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
          <div className="max-w-lg w-full rounded-2xl border border-red-200 bg-white p-6 shadow-sm space-y-4">
            <h1 className="text-lg font-bold text-slate-900">Error de Conexión o Permisos</h1>
            <p className="text-sm text-slate-600 break-words">{this.state.message}</p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:opacity-90"
              >
                Recargar Aplicación
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
