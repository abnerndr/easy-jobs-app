"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProfileInput } from "@/lib/schemas/profile";

const PROFILE_QUERY_KEY = ["profile"] as const;

async function fetchProfile() {
  const response = await fetch("/api/profile");
  if (!response.ok) throw new Error("Erro ao carregar perfil.");
  const body = await response.json();
  return body.profile as (ProfileInput & { id: string }) | null;
}

async function saveProfile(input: ProfileInput) {
  const response = await fetch("/api/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error?.message ?? body?.error ?? "Erro ao salvar perfil.");
  }
  return body.profile;
}

export function useProfileQuery() {
  return useQuery({ queryKey: PROFILE_QUERY_KEY, queryFn: fetchProfile });
}

export function useSaveProfileMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveProfile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PROFILE_QUERY_KEY });
    },
  });
}
