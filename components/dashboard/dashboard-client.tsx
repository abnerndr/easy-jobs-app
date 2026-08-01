"use client";

import { useState } from "react";
import Link from "next/link";
import {
  BriefcaseIcon,
  ExternalLinkIcon,
  Link2Icon,
  SearchIcon,
  SendIcon,
  Settings2Icon,
  Trash2Icon,
  UnlinkIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { StatusBadge } from "@/components/jobs/status-badge";
import { useProfileQuery } from "@/hooks/use-profile";
import {
  useApplySelectedJobsMutation,
  useClearDemoJobsMutation,
  useConnectBoardMutation,
  useConnectionsQuery,
  useDeleteSelectedJobsMutation,
  useDisconnectBoardMutation,
  useJobSearchMutation,
  useJobSettingsQuery,
  useJobsQuery,
  useSaveJobSettingsMutation,
} from "@/hooks/use-jobs";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

export function DashboardClient() {
  const profileQuery = useProfileQuery();
  const settingsQuery = useJobSettingsQuery();
  const connectionsQuery = useConnectionsQuery();
  const jobsQuery = useJobsQuery();
  const searchMutation = useJobSearchMutation();
  const clearDemoMutation = useClearDemoJobsMutation();
  const deleteSelectedMutation = useDeleteSelectedJobsMutation();
  const applySelectedMutation = useApplySelectedJobsMutation();
  const saveSettings = useSaveJobSettingsMutation();
  const connectMutation = useConnectBoardMutation();
  const disconnectMutation = useDisconnectBoardMutation();

  const [limitDraft, setLimitDraft] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [connectingProvider, setConnectingProvider] = useState<
    "linkedin" | "indeed" | null
  >(null);

  const profile = profileQuery.data;
  const usage = settingsQuery.data?.usage;
  const settings = settingsQuery.data?.settings;
  const canSearch = connectionsQuery.data?.canSearch ?? false;
  const linkedIn = connectionsQuery.data?.connections.find(
    (c) => c.provider === "LINKEDIN"
  );
  const indeed = connectionsQuery.data?.connections.find(
    (c) => c.provider === "INDEED"
  );
  const demoCount =
    jobsQuery.data?.filter((item) => item.job.source === "DEMO").length ?? 0;
  const allIds = jobsQuery.data?.map((item) => item.applicationId) ?? [];
  const allSelected = allIds.length > 0 && selectedIds.length === allIds.length;
  const someSelected = selectedIds.length > 0 && !allSelected;

  function toggleSelect(id: string, checked: boolean) {
    setSelectedIds((prev) =>
      checked ? [...new Set([...prev, id])] : prev.filter((value) => value !== id)
    );
  }

  function toggleSelectAll(checked: boolean) {
    setSelectedIds(checked ? allIds : []);
  }

  const limitValue = limitDraft ?? String(settings?.dailyApplyLimit ?? 10);
  const usedToday = usage?.usedToday ?? 0;
  const dailyLimit = settings?.dailyApplyLimit ?? 10;
  const remainingToday = usage?.remainingToday ?? 0;
  const progressValue =
    dailyLimit > 0 ? Math.min(100, Math.round((usedToday / dailyLimit) * 100)) : 0;
  const atLimit = remainingToday === 0;

  async function handleSaveLimit() {
    const dailyApplyLimit = Number(limitValue);
    if (!Number.isFinite(dailyApplyLimit)) {
      toast.error("Informe um número válido.");
      return;
    }
    try {
      await saveSettings.mutateAsync({
        dailyApplyLimit,
        autoQueue: settings?.autoQueue ?? true,
      });
      setLimitDraft(null);
      toast.success("Limite diário atualizado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao salvar.");
    }
  }

  async function handleConnect(provider: "linkedin" | "indeed") {
    setConnectingProvider(provider);
    toast.message(
      `Abrindo Chrome para login no ${provider === "linkedin" ? "LinkedIn" : "Indeed"}…`,
      { description: "Faça login na janela e aguarde a confirmação (até 5 min)." }
    );
    try {
      const result = await connectMutation.mutateAsync(provider);
      toast.success(result.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao conectar.");
    } finally {
      setConnectingProvider(null);
    }
  }

  async function handleDisconnect(provider: "linkedin" | "indeed") {
    try {
      await disconnectMutation.mutateAsync(provider);
      toast.success("Desconectado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao desconectar.");
    }
  }

  async function handleSearch() {
    try {
      const result = await searchMutation.mutateAsync();
      toast.success(result.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao buscar.");
    }
  }

  async function handleClearDemo() {
    try {
      const result = await clearDemoMutation.mutateAsync();
      setSelectedIds([]);
      toast.success(result.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao limpar demos.");
    }
  }

  async function handleDeleteSelected() {
    if (selectedIds.length === 0) {
      toast.error("Selecione ao menos uma vaga.");
      return;
    }
    try {
      const result = await deleteSelectedMutation.mutateAsync(selectedIds);
      setSelectedIds([]);
      toast.success(result.message);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Erro ao remover selecionadas."
      );
    }
  }

  async function handleApplySelected() {
    if (selectedIds.length === 0) {
      toast.error("Selecione ao menos uma vaga LinkedIn.");
      return;
    }
    if (!linkedIn?.connected) {
      toast.error("Conecte o LinkedIn para Easy Apply.");
      return;
    }
    toast.message("Candidatando nas selecionadas…", {
      description:
        "Easy Apply no LinkedIn com sessão salva. Pode levar alguns minutos.",
    });
    try {
      const result = await applySelectedMutation.mutateAsync(selectedIds);
      setSelectedIds([]);
      toast.success(result.message);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Erro ao candidatar."
      );
    }
  }

  if (
    profileQuery.isLoading ||
    settingsQuery.isLoading ||
    connectionsQuery.isLoading
  ) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BriefcaseIcon />
          </EmptyMedia>
          <EmptyTitle>Perfil incompleto</EmptyTitle>
          <EmptyDescription>
            Complete seu perfil com cargos e stack para liberar a busca de vagas.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild>
            <Link href="/profile">Completar perfil</Link>
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Painel</h1>
          <p className="text-muted-foreground max-w-2xl text-sm">
            Conecte LinkedIn e/ou Indeed com login real. Só depois a busca de vagas
            é liberada.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/applications">Ver status</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Contas das plataformas</CardTitle>
          <CardDescription>
            Ao clicar em Conectar, abre um Chrome controlado pelo app. Faça login
            normalmente; a sessão fica salva só neste servidor.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-3 rounded-xl border p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium">LinkedIn</p>
              <Badge variant={linkedIn?.connected ? "default" : "secondary"}>
                {linkedIn?.connected ? "Conectado" : "Desconectado"}
              </Badge>
            </div>
            {linkedIn?.connected ? (
              <Button
                variant="outline"
                onClick={() => handleDisconnect("linkedin")}
                disabled={disconnectMutation.isPending}
              >
                <UnlinkIcon data-icon="inline-start" />
                Desconectar
              </Button>
            ) : (
              <Button
                onClick={() => handleConnect("linkedin")}
                disabled={connectingProvider !== null}
              >
                {connectingProvider === "linkedin" ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <Link2Icon data-icon="inline-start" />
                )}
                {connectingProvider === "linkedin"
                  ? "Aguardando login…"
                  : "Conectar LinkedIn"}
              </Button>
            )}
          </div>

          <div className="flex flex-col gap-3 rounded-xl border p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium">Indeed</p>
              <Badge variant={indeed?.connected ? "default" : "secondary"}>
                {indeed?.connected ? "Conectado" : "Desconectado"}
              </Badge>
            </div>
            {indeed?.connected ? (
              <Button
                variant="outline"
                onClick={() => handleDisconnect("indeed")}
                disabled={disconnectMutation.isPending}
              >
                <UnlinkIcon data-icon="inline-start" />
                Desconectar
              </Button>
            ) : (
              <Button
                onClick={() => handleConnect("indeed")}
                disabled={connectingProvider !== null}
              >
                {connectingProvider === "indeed" ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <Link2Icon data-icon="inline-start" />
                )}
                {connectingProvider === "indeed"
                  ? "Aguardando login…"
                  : "Conectar Indeed"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Buscar vagas reais</CardTitle>
          <CardDescription>
            Usa a sessão logada para abrir LinkedIn/Indeed e coletar vagas do seu
            perfil — sem dados mock.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {profile.jobTitles.map((title) => (
              <Badge key={title} variant="secondary">
                {title}
              </Badge>
            ))}
            <Badge variant="outline">{profile.location}</Badge>
            <Badge variant="outline">{profile.workMode}</Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            Stack: {profile.techStack.join(", ")}
          </p>
          {!canSearch && (
            <Alert>
              <AlertTitle>Conecte uma plataforma</AlertTitle>
              <AlertDescription>
                A busca fica bloqueada até você conectar LinkedIn ou Indeed acima.
              </AlertDescription>
            </Alert>
          )}
          {atLimit && (
            <Alert>
              <AlertTitle>Limite diário atingido</AlertTitle>
              <AlertDescription>
                Aumente o limite abaixo ou volte amanhã para novas buscas.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
        <CardFooter className="flex flex-wrap gap-3">
          <Button
            size="lg"
            onClick={handleSearch}
            disabled={!canSearch || searchMutation.isPending || atLimit}
          >
            {searchMutation.isPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <SearchIcon data-icon="inline-start" />
            )}
            {searchMutation.isPending ? "Buscando vagas…" : "Buscar vagas agora"}
          </Button>
          <Button variant="ghost" asChild>
            <Link href="/profile">Editar perfil</Link>
          </Button>
        </CardFooter>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Uso de hoje</CardTitle>
            <CardDescription>
              {usedToday} de {dailyLimit} vagas · {remainingToday} restantes
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Progress value={progressValue} />
            <p className="text-muted-foreground text-sm">
              Conta encontradas, enfileiradas e aplicadas no dia.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Limite diário</CardTitle>
            <CardDescription>
              Quantas vagas podem entrar na fila por dia.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field orientation="horizontal">
                <FieldLabel htmlFor="daily-limit">Máximo</FieldLabel>
                <Input
                  id="daily-limit"
                  type="number"
                  min={1}
                  max={100}
                  value={limitValue}
                  onChange={(e) => setLimitDraft(e.target.value)}
                  className="max-w-28"
                />
              </Field>
              <FieldDescription>
                Valores entre 1 e 100. Padrão: 10.
              </FieldDescription>
            </FieldGroup>
          </CardContent>
          <CardFooter>
            <Button
              variant="outline"
              onClick={handleSaveLimit}
              disabled={saveSettings.isPending}
            >
              {saveSettings.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Settings2Icon data-icon="inline-start" />
              )}
              Salvar limite
            </Button>
          </CardFooter>
        </Card>
      </div>

      <Separator />

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-medium">Resultados</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{jobsQuery.data?.length ?? 0} vagas</Badge>
            {allIds.length > 0 && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="select-all-jobs"
                  checked={allSelected ? true : someSelected ? "indeterminate" : false}
                  onCheckedChange={(value) => toggleSelectAll(value === true)}
                />
                <Label htmlFor="select-all-jobs" className="text-sm font-normal">
                  Selecionar todas
                </Label>
              </div>
            )}
            <Button
              size="sm"
              onClick={handleApplySelected}
              disabled={
                selectedIds.length === 0 ||
                !linkedIn?.connected ||
                applySelectedMutation.isPending
              }
            >
              {applySelectedMutation.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <SendIcon data-icon="inline-start" />
              )}
              {applySelectedMutation.isPending
                ? "Inscrevendo…"
                : `Inscrever selecionadas (${selectedIds.length})`}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDeleteSelected}
              disabled={
                selectedIds.length === 0 || deleteSelectedMutation.isPending
              }
            >
              {deleteSelectedMutation.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Trash2Icon data-icon="inline-start" />
              )}
              Limpar selecionadas ({selectedIds.length})
            </Button>
            {(demoCount > 0 || clearDemoMutation.isPending) && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleClearDemo}
                disabled={clearDemoMutation.isPending}
              >
                {clearDemoMutation.isPending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <Trash2Icon data-icon="inline-start" />
                )}
                Limpar demos ({demoCount})
              </Button>
            )}
          </div>
        </div>

        {jobsQuery.isLoading && (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}

        {!jobsQuery.isLoading && (jobsQuery.data?.length ?? 0) === 0 && (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchIcon />
              </EmptyMedia>
              <EmptyTitle>Nenhuma vaga ainda</EmptyTitle>
              <EmptyDescription>
                {canSearch
                  ? "Clique em “Buscar vagas agora” para coletar vagas reais."
                  : "Conecte LinkedIn ou Indeed para liberar a busca."}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              {canSearch ? (
                <Button
                  onClick={handleSearch}
                  disabled={searchMutation.isPending || atLimit}
                >
                  {searchMutation.isPending ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <SearchIcon data-icon="inline-start" />
                  )}
                  Buscar vagas agora
                </Button>
              ) : (
                <Button onClick={() => handleConnect("linkedin")}>
                  <Link2Icon data-icon="inline-start" />
                  Conectar LinkedIn
                </Button>
              )}
            </EmptyContent>
          </Empty>
        )}

        <div className="flex flex-col gap-3">
          {jobsQuery.data?.map((item) => {
            const checked = selectedIds.includes(item.applicationId);
            return (
              <Card key={item.applicationId} size="sm">
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(value) =>
                          toggleSelect(item.applicationId, value === true)
                        }
                        aria-label={`Selecionar ${item.job.title}`}
                        className="mt-1"
                      />
                      <div className="flex min-w-0 flex-col gap-1">
                        <CardTitle className="truncate">{item.job.title}</CardTitle>
                        <CardDescription>
                          {item.job.company} · {item.job.location}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{item.matchScore}% match</Badge>
                      <StatusBadge status={item.status} />
                      <Badge variant="secondary">{item.job.source}</Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground line-clamp-2 text-sm">
                    {item.job.description}
                  </p>
                </CardContent>
                <CardFooter>
                  <Button variant="outline" size="sm" asChild>
                    <a
                      href={item.job.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLinkIcon data-icon="inline-start" />
                      Abrir vaga
                    </a>
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
}
