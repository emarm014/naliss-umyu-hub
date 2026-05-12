import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
    children?: ReactNode;
}

interface State {
    hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
    public state: State = { hasError: false };

    public static getDerivedStateFromError(): State {
        return { hasError: true };
    }

    public componentDidCatch(_error: Error, _errorInfo: ErrorInfo): void {
        // Errors are captured silently — no raw stack traces exposed
    }

    public render() {
        if (this.state.hasError) {
            return (
                <div style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    justifyContent: 'center', minHeight: '100vh',
                    backgroundColor: '#f8fafc', padding: '2rem',
                }}>
                    <div style={{
                        backgroundColor: '#fff', borderRadius: 24, padding: '3rem',
                        boxShadow: '0 8px 32px rgba(0,0,0,0.08)', maxWidth: 480,
                        textAlign: 'center', border: '1px solid #f1f5f9',
                    }}>
                        <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
                        <h2 style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', marginBottom: 8 }}>
                            Something went wrong
                        </h2>
                        <p style={{ fontSize: 14, color: '#64748b', marginBottom: 24, lineHeight: 1.6 }}>
                            An unexpected error occurred. Please refresh the page to continue.
                        </p>
                        <button
                            onClick={() => window.location.reload()}
                            style={{
                                backgroundColor: '#052e16', color: '#fff',
                                border: 'none', borderRadius: 12, padding: '12px 32px',
                                fontSize: 14, fontWeight: 700, cursor: 'pointer',
                                letterSpacing: '0.05em', textTransform: 'uppercase',
                            }}
                        >
                            Refresh Page
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
