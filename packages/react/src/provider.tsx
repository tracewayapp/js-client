import React, { createContext, useEffect, useMemo } from "react";
import * as traceway from "@tracewayapp/frontend";
import type { TracewayFrontendOptions } from "@tracewayapp/frontend";

export interface TracewayContextValue {
  captureException: typeof traceway.captureException;
  captureExceptionWithAttributes: typeof traceway.captureExceptionWithAttributes;
  captureMessage: typeof traceway.captureMessage;
}

export const TracewayContext = createContext<TracewayContextValue | null>(null);

export interface TracewayProviderProps {
  connectionString: string;
  options?: TracewayFrontendOptions;
  children: React.ReactNode;
}

export function TracewayProvider({
  connectionString,
  options,
  children,
}: TracewayProviderProps) {
  useEffect(() => {
    traceway.init(connectionString, options);
  }, [connectionString]);

  const value = useMemo<TracewayContextValue>(
    () => ({
      captureException: traceway.captureException,
      captureExceptionWithAttributes: traceway.captureExceptionWithAttributes,
      captureMessage: traceway.captureMessage,
    }),
    [],
  );

  return (
    <TracewayContext.Provider value={value}>{children}</TracewayContext.Provider>
  );
}
