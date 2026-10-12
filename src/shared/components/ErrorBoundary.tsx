import React from 'react';
import * as Sentry from '@sentry/react';
import type { ErrorInfo, ReactNode } from 'react';
import CrashScreen from './CrashScreen';

interface ErrorBoundaryProps {
  children?: ReactNode;
  /** Changing this clears a crash, so moving to another page recovers on its own. */
  resetKey?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  resetKey?: string;
}

// Page-level crash catcher: the header and nav stay usable around it.
export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, resetKey: props.resetKey };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  static getDerivedStateFromProps(props: ErrorBoundaryProps, state: ErrorBoundaryState) {
    if (props.resetKey === state.resetKey) return null;
    return { hasError: false, error: null, resetKey: props.resetKey };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // An error caught here never reaches Sentry's global handlers, so report it.
    Sentry.captureException(error, { extra: { componentStack: info.componentStack } });
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return <CrashScreen error={this.state.error} onRetry={() => this.setState({ hasError: false, error: null })} />;
    }
    return this.props.children;
  }
}
