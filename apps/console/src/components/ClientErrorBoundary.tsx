'use client';

import React from 'react';

type ClientErrorBoundaryProps = {
  children: React.ReactNode;
  label?: string;
  fallback?: React.ReactNode;
};

type ClientErrorBoundaryState = {
  hasError: boolean;
  error?: Error;
};

export class ClientErrorBoundary extends React.Component<
  ClientErrorBoundaryProps,
  ClientErrorBoundaryState
> {
  state: ClientErrorBoundaryState = {
    hasError: false,
    error: undefined,
  };

  static getDerivedStateFromError(error: Error): ClientErrorBoundaryState {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[ArcLayer boundary] ${this.props.label ?? 'component'} failed`, error, errorInfo);
    }
  }

  private reset = () => {
    this.setState({
      hasError: false,
      error: undefined,
    });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    if (this.props.fallback !== undefined) {
      return this.props.fallback;
    }

    return (
      <div className="rounded-sm border border-[#C5A67C]/20 bg-[#0A0A0A]/90 p-4 text-[#EAE4D8]">
        <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C]">
          Runtime boundary
        </div>

        <div className="mt-2 text-sm font-semibold uppercase tracking-[0.08em] text-[#F5F0E5]">
          {this.props.label ?? 'Component'} degraded
        </div>

        <p className="mt-2 text-xs leading-5 text-[#EAE4D8]/60">
          This section hit a browser exception and was isolated from the rest of the page.
        </p>

        <button
          type="button"
          onClick={this.reset}
          className="mt-3 rounded-sm border border-[#C5A67C]/35 bg-[#C5A67C]/10 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[#C5A67C] hover:bg-[#C5A67C]/15"
        >
          Retry section
        </button>
      </div>
    );
  }
}

export default ClientErrorBoundary;
