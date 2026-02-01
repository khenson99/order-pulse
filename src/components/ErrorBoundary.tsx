import { Component, ErrorInfo, ReactNode } from 'react';
import { Icons } from './Icons';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-[300px] flex flex-col items-center justify-center p-8 bg-arda-bg-secondary border border-red-500/30 rounded-lg">
          <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mb-4">
            <Icons.AlertCircle className="w-8 h-8 text-red-400" />
          </div>
          <h3 className="text-lg font-bold text-arda-text-primary mb-2">Something went wrong</h3>
          <p className="text-sm text-arda-text-muted text-center max-w-md mb-4">
            {this.state.error?.message || 'An unexpected error occurred while rendering this component.'}
          </p>
          <button 
            onClick={this.handleRetry}
            className="bg-arda-bg-tertiary hover:bg-arda-border text-arda-text-primary px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition-colors"
          >
            <Icons.RefreshCw className="w-4 h-4" />
            Try Again
          </button>
          {import.meta.env.DEV && this.state.errorInfo && (
            <details className="mt-4 p-4 bg-arda-bg-secondary rounded text-xs text-arda-text-muted max-w-full overflow-auto">
              <summary className="cursor-pointer text-arda-text-secondary mb-2">Stack Trace</summary>
              <pre className="whitespace-pre-wrap break-words">
                {this.state.errorInfo.componentStack}
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
