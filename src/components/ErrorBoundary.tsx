import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { LocaleContext } from '../context/LocaleContext';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  static contextType = LocaleContext;
  declare context: React.ContextType<typeof LocaleContext>;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[Kura ErrorBoundary] React rendering error caught:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReload = () => {
    if (this.props.onReset) {
      this.setState({ hasError: false, error: null, errorInfo: null });
      this.props.onReset();
    } else {
      window.location.reload();
    }
  };

  render() {
    const t = this.context?.t ?? ((key: string) => key);

    if (this.state.hasError) {
      return (
        <div className="min-h-[400px] flex flex-col items-center justify-center p-8 text-center bg-surface/40 rounded-2xl ring-1 ring-border my-6">
          <div className="h-12 w-12 rounded-full bg-status-offline/10 text-status-offline flex items-center justify-center mb-4">
            <AlertCircle className="h-6 w-6" />
          </div>
          <h2 className="font-serif text-2xl text-primary font-normal mb-2">
            {this.props.fallbackTitle || t('errors.boundaryTitle')}
          </h2>
          <p className="text-xs text-secondary max-w-md mb-6 leading-relaxed">
            {this.state.error?.message || t('errors.boundaryFallback')}
          </p>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={this.handleReload}
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-xs font-medium text-background hover:bg-accent-hover transition"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>{t('common.reload')}</span>
            </button>
          </div>

          {this.state.error?.stack && (
            <details className="mt-8 text-left max-w-xl w-full">
              <summary className="text-[11px] font-mono text-tertiary cursor-pointer hover:text-secondary">
                {t('errors.techDetails')}
              </summary>
              <pre className="mt-2 p-3 rounded-lg bg-surface text-[10px] font-mono text-secondary overflow-auto max-h-48 whitespace-pre-wrap ring-1 ring-border">
                {this.state.error.stack}
                {this.state.errorInfo?.componentStack}
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
