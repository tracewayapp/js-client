import React, { Component, createContext } from "react";
import * as traceway from "@tracewayapp/frontend";
import type {
  TracewayFrontendOptions,
  StandaloneOptions,
} from "@tracewayapp/frontend";

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
  connectionString: string | StandaloneOptions;
  options?: TracewayFrontendOptions;
  /**
   * The app's router, to name every view by its route template (`/orders/:id`): what `createBrowserRouter`
   * (React Router) or `createRouter` (TanStack Router) returned. Not needed in React Router's framework mode,
   * Remix or the Next.js Pages Router, which are read from the page.
   */
  router?: object;
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
    if (props.router) traceway.trackRouter(props.router);
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
