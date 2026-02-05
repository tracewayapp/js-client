import React, { Component } from "react";
import * as traceway from "@tracewayapp/frontend";

export interface TracewayErrorBoundaryProps {
  children: React.ReactNode;
  fallback: React.ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface TracewayErrorBoundaryState {
  hasError: boolean;
}

export class TracewayErrorBoundary extends Component<
  TracewayErrorBoundaryProps,
  TracewayErrorBoundaryState
> {
  constructor(props: TracewayErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): TracewayErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    traceway.captureException(error);
    this.props.onError?.(error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}
