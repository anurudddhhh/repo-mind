'use client';

import React, { Component, ReactNode, ErrorInfo } from 'react';
import { AlertOctagon, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  // Called when a descendant component throws an error during rendering
  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error inside ErrorBoundary:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 my-4 bg-panel border border-border rounded-2xl shadow-premium space-y-4 text-center flex flex-col items-center justify-center">
          <div className="p-3 bg-red-500/10 text-red-500 rounded-2xl border border-red-500/20">
            <AlertOctagon size={24} />
          </div>

          <div className="space-y-1 max-w-md">
            <h3 className="font-bold text-base text-foreground">
              {this.props.fallbackTitle || 'Component Render Error'}
            </h3>
            <p className="text-xs text-foreground-muted">
              {this.state.error?.message || 'An unexpected rendering error occurred in this module.'}
            </p>
          </div>

          <button
            onClick={this.handleReset}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-border text-xs font-medium text-foreground hover:bg-border-hover transition-colors"
          >
            <RefreshCw size={14} />
            <span>Reset Section</span>
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}