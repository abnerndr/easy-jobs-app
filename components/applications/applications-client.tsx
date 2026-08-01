"use client";

import { useState } from "react";
import Link from "next/link";
import { ExternalLinkIcon, ListFilterIcon, SearchIcon } from "lucide-react";
import {
  useApplicationsQuery,
  type ApplicationStatus,
} from "@/hooks/use-jobs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge, statusLabel } from "@/components/jobs/status-badge";

const FILTERS: { value: "all" | ApplicationStatus; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "FOUND", label: "Encontrada" },
  { value: "QUEUED", label: "Na fila" },
  { value: "APPLIED", label: "Aplicada" },
  { value: "EXTERNAL_REDIRECT", label: "Site externo" },
  { value: "FAILED", label: "Falhou" },
  { value: "SKIPPED", label: "Ignorada" },
];

export function ApplicationsClient() {
  const [filter, setFilter] = useState<"all" | ApplicationStatus>("all");
  const query = useApplicationsQuery(filter === "all" ? undefined : filter);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Status das vagas</h1>
          <p className="text-muted-foreground text-sm">
            Acompanhe candidaturas encontradas, enfileiradas e aplicadas.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{query.data?.length ?? 0}</Badge>
          <Select
            value={filter}
            onValueChange={(value) => setFilter(value as "all" | ApplicationStatus)}
          >
            <SelectTrigger className="w-44">
              <ListFilterIcon data-icon="inline-start" />
              <SelectValue placeholder="Filtrar status" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {FILTERS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>

      {query.isLoading && (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      )}

      {!query.isLoading && (query.data?.length ?? 0) === 0 && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchIcon />
            </EmptyMedia>
            <EmptyTitle>Nenhuma candidatura</EmptyTitle>
            <EmptyDescription>
              {filter === "all"
                ? "Busque vagas no painel para começar a acompanhar o status."
                : `Nada com status “${statusLabel(filter)}”.`}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild>
              <Link href="/dashboard">Ir ao painel</Link>
            </Button>
          </EmptyContent>
        </Empty>
      )}

      {(query.data?.length ?? 0) > 0 && (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vaga</TableHead>
                <TableHead>Empresa</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Match</TableHead>
                <TableHead>Atualizado</TableHead>
                <TableHead className="text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data?.map((app) => (
                <TableRow key={app.id}>
                  <TableCell className="font-medium">{app.job.title}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {app.job.company}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={app.status} />
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{app.matchScore}%</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(app.updatedAt).toLocaleString("pt-BR")}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" asChild>
                      <a href={app.job.url} target="_blank" rel="noopener noreferrer">
                        <ExternalLinkIcon data-icon="inline-start" />
                        Abrir
                      </a>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
