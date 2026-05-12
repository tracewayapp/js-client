import React, { Component, createContext } from "react";
import * as traceway from "@tracewayapp/frontend";
import type { TracewayFrontendOptions } from "@tracewayapp/frontend";

export interface TracewayContextValue {
  captureException: typeof traceway.captureException;
  captureExceptionWithAttributes: typeof traceway.captureExceptionWithAttributes;
  captureMessage: typeof traceway.captureMessage;
  recordAction: typeof traceway.recordAction;
}

export const TracewayContext = createContext<TracewayContextValue | null>(null);

const contextValue: TracewayContextValue = {
  captureException: traceway.captureException,
  captureExceptionWithAttributes: traceway.captureExceptionWithAttributes,
  captureMessage: traceway.captureMessage,
  recordAction: traceway.recordAction,
};

export interface TracewayProviderProps {
  connectionString: string;
  options?: TracewayFrontendOptions;
  children: React.ReactNode;
}

interface TracewayProviderState {
  thrown: Error | null;
}

export class TracewayProvider extends Component<
  TracewayProviderProps,
  TracewayProviderState
> {
  state: TracewayProviderState = { thrown: null };

  constructor(props: TracewayProviderProps) {
    super(props);
    traceway.init(props.connectionString, props.options);
  }

  static getDerivedStateFromError(error: Error): TracewayProviderState {
    traceway.captureException(error);
    return { thrown: error };
  }

  render(): React.ReactNode {
    if (this.state.thrown) {
      throw this.state.thrown;
    }
    return (
      <TracewayContext.Provider value={contextValue}>
        {this.props.children}
      </TracewayContext.Provider>
    );
  }
}
