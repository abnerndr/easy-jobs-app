"use client";

import { useRef } from "react";
import { toast } from "sonner";
import { useResumeQuery, useUploadResumeMutation } from "@/hooks/use-resume";
import { Button } from "@/components/ui/button";

export function ResumeUpload() {
  const { data: resume, isLoading, isError } = useResumeQuery();
  const mutation = useUploadResumeMutation();
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    mutation.mutate(file, {
      onSuccess: () => toast.success("Currículo enviado."),
      onError: (error: Error) => toast.error(error.message),
    });
    event.target.value = "";
  }

  if (isLoading) return <p className="text-muted-foreground">Carregando currículo...</p>;

  if (isError) {
    return (
      <p className="text-destructive">
        Erro ao carregar currículo. Recarregue a página para tentar novamente.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {resume ? (
        <p className="text-sm">
          Arquivo atual: <span className="font-medium">{resume.fileName}</span>{" "}
          <a href="/api/resumes/download" className="underline">
            baixar
          </a>
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Nenhum currículo enviado ainda.</p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={handleFileChange}
      />
      <Button
        type="button"
        variant="outline"
        disabled={mutation.isPending}
        onClick={() => inputRef.current?.click()}
      >
        {mutation.isPending ? "Enviando..." : resume ? "Substituir PDF" : "Enviar PDF"}
      </Button>
    </div>
  );
}
