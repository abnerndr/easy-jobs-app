"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const RESUME_QUERY_KEY = ["resume"] as const;

interface ResumeMeta {
  id: string;
  fileName: string;
  size: number;
  uploadedAt: string;
}

async function fetchResume() {
  const response = await fetch("/api/resumes");
  if (!response.ok) throw new Error("Erro ao carregar currículo.");
  const body = await response.json();
  return body.resume as ResumeMeta | null;
}

async function uploadResume(file: File) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/api/resumes", { method: "POST", body: formData });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error?.message ?? body?.error ?? "Erro ao enviar currículo.");
  }
  return body.resume as ResumeMeta;
}

export function useResumeQuery() {
  return useQuery({ queryKey: RESUME_QUERY_KEY, queryFn: fetchResume });
}

export function useUploadResumeMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: uploadResume,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: RESUME_QUERY_KEY });
    },
  });
}
