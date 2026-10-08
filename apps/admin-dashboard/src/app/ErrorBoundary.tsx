import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { ErrorState } from '@jpb/ui';
import { errorReference } from './errorReference';

interface Props {
  children: ReactNode;
  /** Compact in-page variant for one section (the shell stays usable). */
  scope?: 'app' | 'section';
  /** Changing this resets the boundary (e.g. the route path). */
  resetKey?: string;
}

interface State {
  ref: string | null;
}

/** Catches render errors: friendly copy plus a short reference — never a stack trace on screen. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { ref: null };

  static getDerivedStateFromError(): State {
    return { ref: errorReference() };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[control room] render error', this.state.ref, error, info.componentStack);
  }

  override componentDidUpdate(prev: Props): void {
    if (prev.resetKey !== this.props.resetKey && this.state.ref) this.setState({ ref: null });
  }

  override render(): ReactNode {
    if (!this.state.ref) return this.props.children;
    const section = this.props.scope === 'section';
    return (
      <div className={section ? 'acr-section-error' : 'acr-fullpage'}>
        <ErrorState
          title={section ? 'This section could not be displayed' : 'The control room hit a problem'}
          description="Tournaments keep running on the server and nothing was changed by this error. Try again, or open another section."
          onRetry={() => this.setState({ ref: null })}
          reference={this.state.ref}
        />
      </div>
    );
  }
}
