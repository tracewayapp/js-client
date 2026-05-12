import React, { Component, createContext } from "react";
import {
  init,
  captureException,
  captureExceptionWithAttributes,
  captureMessage,
  recordAction,
  recordNavigation,
  setDeviceAttributes,
} from "./sdk.js";
import type { TracewayReactNativeOptions } from "./client.js";

export interface TracewayContextValue {
  captureException: typeof captureException;
  captureExceptionWithAttributes: typeof captureExceptionWithAttributes;
  captureMessage: typeof captureMessage;
  recordAction: typeof recordAction;
  recordNavigation: typeof recordNavigation;
  setDeviceAttributes: typeof setDeviceAttributes;
}

export const TracewayContext = createContext<TracewayContextValue | null>(null);

const contextValue: TracewayContextValue = {
  captureException,
  captureExceptionWithAttributes,
  captureMessage,
  recordAction,
  recordNavigation,
  setDeviceAttributes,
};

export interface TracewayProviderProps {
  connectionString: string;
  options?: TracewayReactNativeOptions;
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
    init(props.connectionString, props.options);
  }

  static getDerivedStateFromError(error: Error): TracewayProviderState {
    captureException(error);
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
