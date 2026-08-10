import { Badge } from "@/components/ui/badge";

const STATUS_LABEL: Record<string, string> = {
  FOUND: "Encontrada",
  QUEUED: "Na fila",
  MATCHED: "Combinou",
  APPLIED: "Aplicada",
  EXTERNAL_REDIRECT: "Site externo",
  FAILED: "Falhou",
  SKIPPED: "Ignorada",
};

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  FOUND: "secondary",
  QUEUED: "default",
  MATCHED: "default",
  APPLIED: "outline",
  EXTERNAL_REDIRECT: "outline",
  FAILED: "destructive",
  SKIPPED: "secondary",
};

export function statusLabel(status: string) {
  return STATUS_LABEL[status] ?? status;
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={STATUS_VARIANT[status] ?? "secondary"}>
      {statusLabel(status)}
    </Badge>
  );
}
