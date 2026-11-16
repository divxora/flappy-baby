import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
  stack: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = {
      hasError: false,
      message: '',
      stack: '',
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'Unexpected runtime error while rendering the game.',
      stack: error?.stack || '',
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-[#0B1120] p-4 text-slate-100">
          <div className="w-full max-w-lg rounded-2xl border border-red-500/40 bg-[#11192B] p-6 shadow-2xl">
            <h1 className="text-xl font-bold text-red-400">
              Game Initialization Error
            </h1>
            <p className="mt-2 text-sm text-slate-300">
              The application encountered an unexpected error instead of loading properly.
            </p>
            <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/70 p-3 font-mono text-xs text-red-300 break-words">
              {this.state.message}
            </div>
            {this.state.stack && (
              <pre className="mt-3 max-h-40 overflow-auto rounded-lg border border-slate-800 bg-slate-950/70 p-3 font-mono text-[11px] text-slate-400">
                {this.state.stack}
              </pre>
            )}
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-amber-400"
              >
                Reload Game
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
