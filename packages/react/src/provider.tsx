import React, { Component, createContext } from "react";
import { guarded } from "@tracewayapp/core";
import * as traceway from "@tracewayapp/frontend";
import type {
  TracewayFrontendOptions,
  StandaloneOptions,
} from "@tracewayapp/frontend";

/** `init()` with the wrapper's fields: `token` and `baseUrl` next to `options`, or the deprecated `connectionString`. */
function startTraceway({
  token,
  baseUrl,
  options,
  connectionString,
}: Pick<TracewayProviderProps, "token" | "baseUrl" | "options" | "connectionString">): void {
  if (typeof connectionString === "string") traceway.init(connectionString, options);
  else
    traceway.init({
      ...connectionString,
      ...options,
      token: token ?? options?.token ?? connectionString?.token,
      baseUrl: baseUrl ?? options?.baseUrl ?? connectionString?.baseUrl,
    });
}

export interface TracewayContextValue {
  captureException: typeof traceway.captureException;
  captureExceptionWithAttributes: typeof traceway.captureExceptionWithAttributes;
  captureMessage: typeof traceway.captureMessage;
  recordAction: typeof traceway.recordAction;
}

export const TracewayContext = createContext<TracewayContextValue | null>(null);

/** Also what `useTraceway()` returns outside the provider: the functions work wherever the SDK runs. */
export const contextValue: TracewayContextValue = {
  captureException: traceway.captureException,
  captureExceptionWithAttributes: traceway.captureExceptionWithAttributes,
  captureMessage: traceway.captureMessage,
  recordAction: traceway.recordAction,
};

export interface TracewayProviderProps {
  /** The project token: `<TracewayProvider token={import.meta.env.VITE_TRACEWAY_TOKEN}>`. */
  token?: string;
  /** The Traceway server, for a self-hosted one. Default `https://cloud.tracewayapp.com`. */
  baseUrl?: string;
  /** Every other option of the browser SDK. */
  options?: TracewayFrontendOptions;
  /** @deprecated Use `token` (and `baseUrl` for a self-hosted server); logs one deprecation warning. */
  connectionString?: string | StandaloneOptions;
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
    // In render: a failure here would unmount the app (a build without its token).
    guarded("TracewayProvider", () => {
      if (props.router) traceway.trackRouter(props.router);
      startTraceway(props);
    });
  }

  static getDerivedStateFromError(error: Error): TracewayProviderState {
    guarded("TracewayProvider", () => traceway.captureException(error));
    // The app's error, rethrown by render below exactly as it would be without Traceway.
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
