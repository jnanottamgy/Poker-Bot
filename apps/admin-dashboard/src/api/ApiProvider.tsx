import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { AdminApi } from './client';
import type { Backend } from './backend';
import { QueryClient } from './query/QueryClient';

interface ApiContextValue {
  backend: Backend;
  queryClient: QueryClient;
}

const ApiContext = createContext<ApiContextValue | null>(null);

export function ApiProvider({ backend, queryClient, children }: { backend: Backend; queryClient?: QueryClient; children: ReactNode }) {
  const value = useMemo(() => ({ backend, queryClient: queryClient ?? new QueryClient() }), [backend, queryClient]);
  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

function useCtx(): ApiContextValue {
  const ctx = useContext(ApiContext);
  if (!ctx) throw new Error('ApiProvider is missing');
  return ctx;
}

/** The typed REST client (`createAdminApi`). */
export function useApi(): AdminApi {
  return useCtx().backend.api;
}

export function useBackend(): Backend {
  return useCtx().backend;
}

export function useQueryClient(): QueryClient {
  return useCtx().queryClient;
}
