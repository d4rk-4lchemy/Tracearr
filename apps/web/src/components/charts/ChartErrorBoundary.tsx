import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ChartErrorBoundaryProps {
  children: ReactNode;
  resetKey: string | number | undefined;
  title: string;
}

interface ChartErrorBoundaryState {
  hasError: boolean;
}

/** Keep a third-party chart failure from unmounting the whole Dashboard. */
export class ChartErrorBoundary extends Component<ChartErrorBoundaryProps, ChartErrorBoundaryState> {
  override state: ChartErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ChartErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`Failed to render ${this.props.title} chart`, error, errorInfo);
  }

  override componentDidUpdate(previousProps: ChartErrorBoundaryProps) {
    if (this.state.hasError && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="text-muted-foreground flex h-[180px] items-center justify-center rounded-lg border border-dashed text-sm"
        >
          Chart temporarily unavailable
        </div>
      );
    }

    return this.props.children;
  }
}
