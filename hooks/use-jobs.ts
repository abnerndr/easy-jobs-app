"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { JobSettingsInput } from "@/lib/schemas/jobs";
import type { APPLICATION_STATUS_VALUES } from "@/lib/schemas/jobs";

export type ApplicationStatus = (typeof APPLICATION_STATUS_VALUES)[number];

export type JobListItem = {
  applicationId: string;
  status: ApplicationStatus;
  matchScore: number;
  createdAt: string;
  job: {
    id: string;
    title: string;
    company: string;
    location: string;
    url: string;
    source: string;
    workMode: string | null;
    description: string;
  };
};

export type ApplicationListItem = {
  id: string;
  status: ApplicationStatus;
  matchScore: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  job: {
    id: string;
    title: string;
    company: string;
    location: string;
    url: string;
    source: string;
  };
};

const JOBS_KEY = ["jobs"] as const;
const APPLICATIONS_KEY = ["applications"] as const;
const SETTINGS_KEY = ["job-settings"] as const;
const CONNECTIONS_KEY = ["connections"] as const;

export type BoardConnection = {
  provider: "LINKEDIN" | "INDEED";
  connected: boolean;
  connectedAt: string | null;
  lastUsedAt: string | null;
};

export type ConnectBoardInput = {
  provider: "linkedin" | "indeed";
  mode?: "browser" | "import";
  cookies?: string;
  storageState?: unknown;
};

async function fetchConnections() {
  const response = await fetch("/api/connections");
  if (!response.ok) throw new Error("Erro ao carregar conexões.");
  return response.json() as Promise<{
    connections: BoardConnection[];
    canSearch: boolean;
  }>;
}

async function connectBoard(input: ConnectBoardInput | "linkedin" | "indeed") {
  const payload: ConnectBoardInput =
    typeof input === "string" ? { provider: input } : input;
  const { provider, ...body } = payload;
  const response = await fetch(`/api/connections/${provider}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const responseBody = await response.json();
  if (!response.ok) {
    throw new Error(
      responseBody?.error?.message ?? responseBody?.error ?? "Falha ao conectar."
    );
  }
  return responseBody as {
    provider: string;
    connected: boolean;
    message: string;
    mode?: string;
  };
}

async function disconnectBoard(provider: "linkedin" | "indeed") {
  const response = await fetch(`/api/connections/${provider}`, {
    method: "DELETE",
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error?.message ?? body?.error ?? "Falha ao desconectar.");
  }
  return body;
}

async function fetchJobs() {
  const response = await fetch("/api/jobs");
  if (!response.ok) throw new Error("Erro ao carregar vagas.");
  const body = await response.json();
  return body.jobs as JobListItem[];
}

async function fetchApplications(status?: ApplicationStatus) {
  const url = status
    ? `/api/applications?status=${encodeURIComponent(status)}`
    : "/api/applications";
  const response = await fetch(url);
  if (!response.ok) throw new Error("Erro ao carregar candidaturas.");
  const body = await response.json();
  return body.applications as ApplicationListItem[];
}

async function fetchJobSettings() {
  const response = await fetch("/api/settings/job");
  if (!response.ok) throw new Error("Erro ao carregar configurações.");
  return response.json() as Promise<{
    settings: JobSettingsInput & { autoQueue: boolean };
    usage: { usedToday: number; remainingToday: number };
  }>;
}

async function saveJobSettings(input: JobSettingsInput) {
  const response = await fetch("/api/settings/job", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error?.message ?? body?.error ?? "Erro ao salvar.");
  }
  return body;
}

async function triggerJobSearch() {
  const response = await fetch("/api/jobs/search", { method: "POST" });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error?.message ?? body?.error ?? "Erro ao buscar vagas.");
  }
  return body as {
    mode: "sync" | "queued";
    message: string;
    created?: number;
    source?: string;
    remainingToday?: number;
  };
}

async function clearDemoJobs() {
  const response = await fetch("/api/jobs/demo", { method: "DELETE" });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error?.message ?? body?.error ?? "Erro ao limpar demos.");
  }
  return body as {
    deletedApplications: number;
    deletedJobs: number;
    message: string;
  };
}

async function deleteSelectedJobs(applicationIds: string[]) {
  const response = await fetch("/api/jobs", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applicationIds }),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(
      body?.error?.message ?? body?.error ?? "Erro ao remover selecionadas."
    );
  }
  return body as {
    deletedApplications: number;
    deletedJobs: number;
    message: string;
  };
}

async function applySelectedJobs(applicationIds: string[]) {
  const response = await fetch("/api/jobs/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applicationIds }),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(
      body?.error?.message ?? body?.error ?? "Erro ao candidatar selecionadas."
    );
  }
  return body as {
    processed: number;
    applied: number;
    external: number;
    failed: number;
    skipped: number;
    remainingApplyQuota: number;
    message: string;
  };
}

export function useJobsQuery() {
  return useQuery({ queryKey: JOBS_KEY, queryFn: fetchJobs });
}

export function useApplicationsQuery(status?: ApplicationStatus) {
  return useQuery({
    queryKey: [...APPLICATIONS_KEY, status ?? "all"],
    queryFn: () => fetchApplications(status),
  });
}

export function useJobSettingsQuery() {
  return useQuery({ queryKey: SETTINGS_KEY, queryFn: fetchJobSettings });
}

export function useSaveJobSettingsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveJobSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });
    },
  });
}

export function useJobSearchMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: triggerJobSearch,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: JOBS_KEY });
      queryClient.invalidateQueries({ queryKey: APPLICATIONS_KEY });
      queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });
    },
  });
}

export function useClearDemoJobsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: clearDemoJobs,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: JOBS_KEY });
      queryClient.invalidateQueries({ queryKey: APPLICATIONS_KEY });
      queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });
    },
  });
}

export function useDeleteSelectedJobsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteSelectedJobs,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: JOBS_KEY });
      queryClient.invalidateQueries({ queryKey: APPLICATIONS_KEY });
      queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });
    },
  });
}

export function useApplySelectedJobsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: applySelectedJobs,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: JOBS_KEY });
      queryClient.invalidateQueries({ queryKey: APPLICATIONS_KEY });
      queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });
    },
  });
}

export function useConnectionsQuery() {
  return useQuery({ queryKey: CONNECTIONS_KEY, queryFn: fetchConnections });
}

export function useConnectBoardMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: connectBoard,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONNECTIONS_KEY });
    },
  });
}

export function useDisconnectBoardMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: disconnectBoard,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONNECTIONS_KEY });
    },
  });
}
