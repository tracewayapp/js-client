import React, { createContext, useEffect, useMemo } from "react";
import {
  init,
  captureException,
  captureExceptionWithAttributes,
  captureMessage,
  recordAction,
  recordNavigation,
} from "./sdk.js";
import type { TracewayReactNativeOptions } from "./client.js";

export interface TracewayContextValue {
  captureException: typeof captureException;
  captureExceptionWithAttributes: typeof captureExceptionWithAttributes;
  captureMessage: typeof captureMessage;
  recordAction: typeof recordAction;
  recordNavigation: typeof recordNavigation;
}

export const TracewayContext = createContext<TracewayContextValue | null>(null);

export interface TracewayProviderProps {
  connectionString: string;
  options?: TracewayReactNativeOptions;
  children: React.ReactNode;
}

export function TracewayProvider({
  connectionString,
  options,
  children,
}: TracewayProviderProps) {
  useEffect(() => {
    init(connectionString, options);
  }, [connectionString]);

  const value = useMemo<TracewayContextValue>(
    () => ({
      captureException,
      captureExceptionWithAttributes,
      captureMessage,
      recordAction,
      recordNavigation,
    }),
    [],
  );

  return (
    <TracewayContext.Provider value={value}>
      {children}
    </TracewayContext.Provider>
  );
}
