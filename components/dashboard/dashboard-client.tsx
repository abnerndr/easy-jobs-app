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
import { Textarea } from "@/components/ui/textarea";
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
  const [startingProvider, setStartingProvider] = useState<
    "linkedin" | "indeed" | null
  >(null);
  const [linkedinCookies, setLinkedinCookies] = useState("");
  const [indeedCookies, setIndeedCookies] = useState("");
  const [showCookieFallback, setShowCookieFallback] = useState<{
    linkedin: boolean;
    indeed: boolean;
  }>({ linkedin: false, indeed: false });
  const [remoteSession, setRemoteSession] = useState<{
    provider: "linkedin" | "indeed";
    sessionId: string;
    novncUrl: string | null;
    displayMode: "novnc" | "local-window";
  } | null>(null);
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
  const easyApplyIds =
    jobsQuery.data
      ?.filter(
        (item) =>
          item.job.source === "LINKEDIN" && item.job.easyApply === true
      )
      .map((item) => item.applicationId) ?? [];
  const allSelected = allIds.length > 0 && selectedIds.length === allIds.length;
  const someSelected = selectedIds.length > 0 && !allSelected;
  const selectedEasyApplyCount = selectedIds.filter((id) =>
    easyApplyIds.includes(id)
  ).length;

  function isEasyApplyJob(item: {
    job: { source: string; easyApply: boolean | null };
  }) {
    return item.job.source === "LINKEDIN" && item.job.easyApply === true;
  }

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

  async function handleImportCookies(provider: "linkedin" | "indeed") {
    const cookies =
      provider === "linkedin" ? linkedinCookies.trim() : indeedCookies.trim();
    if (!cookies) {
      toast.error(
        provider === "linkedin"
          ? "Cole o cookie li_at (ou o JSON exportado)."
          : "Cole os cookies de sessão do Indeed."
      );
      return;
    }

    setStartingProvider(provider);
    toast.message(
      `Importando sessão do ${provider === "linkedin" ? "LinkedIn" : "Indeed"}…`
    );
    try {
      const result = await connectMutation.mutateAsync({
        provider,
        mode: "import",
        cookies,
      });
      if (provider === "linkedin") setLinkedinCookies("");
      else setIndeedCookies("");
      void connectionsQuery.refetch();
      toast.success(result.message ?? "Conectado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao importar.");
    } finally {
      setStartingProvider(null);
    }
  }

  async function pollRemoteUntilDone(
    provider: "linkedin" | "indeed",
    sessionId: string
  ) {
    const deadline = Date.now() + 5 * 60_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      const response = await fetch(
        `/api/connections/${provider}/remote?sessionId=${encodeURIComponent(sessionId)}`
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(
          typeof body?.error === "string"
            ? body.error
            : body?.error?.message ?? "Falha ao consultar status."
        );
      }
      if (body.status === "connected") {
        return body;
      }
      if (
        body.status === "failed" ||
        body.status === "expired" ||
        body.status === "cancelled"
      ) {
        throw new Error(body.error || `Login ${body.status}.`);
      }
    }
    throw new Error("Tempo esgotado aguardando login remoto.");
  }

  async function handleRemoteConnect(provider: "linkedin" | "indeed") {
    setStartingProvider(provider);
    setRemoteSession(null);
    toast.message(
      `Abrindo Chromium remoto (${provider === "linkedin" ? "LinkedIn" : "Indeed"})…`,
      { description: "Faça login na tela abaixo (CAPTCHA/2FA inclusive)." }
    );
    try {
      const response = await fetch(`/api/connections/${provider}/remote`, {
        method: "POST",
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(
          typeof body?.error === "string"
            ? body.error
            : body?.error?.message ?? "Falha ao abrir login remoto."
        );
      }
      setRemoteSession({
        provider,
        sessionId: body.sessionId as string,
        novncUrl: (body.novncUrl as string | null) ?? null,
        displayMode:
          body.displayMode === "novnc" && body.novncUrl
            ? "novnc"
            : "local-window",
      });
      toast.message(body.message ?? "Faça login na janela do Chromium.");
      const done = await pollRemoteUntilDone(provider, body.sessionId as string);
      setRemoteSession(null);
      void connectionsQuery.refetch();
      toast.success(done.message ?? "Conectado.");
    } catch (error) {
      setRemoteSession(null);
      toast.error(error instanceof Error ? error.message : "Falha ao conectar.");
    } finally {
      setStartingProvider(null);
    }
  }

  async function handleRemoteCancel() {
    if (!remoteSession) return;
    await fetch(
      `/api/connections/${remoteSession.provider}/remote?sessionId=${encodeURIComponent(remoteSession.sessionId)}`,
      { method: "DELETE" }
    ).catch(() => undefined);
    setRemoteSession(null);
    setStartingProvider(null);
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
    const toApply = selectedIds.filter((id) => easyApplyIds.includes(id));
    if (toApply.length === 0) {
      toast.error(
        "Nenhuma vaga Easy Apply selecionada. A inscrição automática só funciona nessas."
      );
      return;
    }
    if (!linkedIn?.connected) {
      toast.error("Conecte o LinkedIn para Easy Apply.");
      return;
    }
    toast.message("Candidatando nas Easy Apply selecionadas…", {
      description:
        "Easy Apply no LinkedIn com sessão salva + IA. Pode levar alguns minutos.",
    });
    try {
      const result = await applySelectedMutation.mutateAsync(toApply);
      setSelectedIds((prev) => prev.filter((id) => !toApply.includes(id)));
      toast.success(result.message);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Erro ao candidatar."
      );
    }
  }

  async function handleDeleteAll() {
    if (allIds.length === 0) {
      toast.error("Não há vagas na listagem.");
      return;
    }
    try {
      const result = await deleteSelectedMutation.mutateAsync(allIds);
      setSelectedIds([]);
      toast.success(result.message);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Erro ao remover vagas."
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
            Conecte LinkedIn e/ou Indeed pelo Chromium remoto (noVNC). Depois a
            busca libera; inscrição automática só em vagas Easy Apply.
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
            No Mac abre o Chrome neste computador (janela do sistema — não um
            iframe). Em produção com Docker/Dokploy (Dockerfile) usa tela remota
            noVNC.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {remoteSession ? (
            <div className="flex flex-col gap-3 rounded-xl border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">
                  Login remoto —{" "}
                  {remoteSession.provider === "linkedin" ? "LinkedIn" : "Indeed"}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleRemoteCancel}
                >
                  Cancelar
                </Button>
              </div>
              <p className="text-muted-foreground text-sm">
                {remoteSession.displayMode === "local-window"
                  ? "Uma janela do Chromium abriu neste Mac. Faça login lá (CAPTCHA/2FA). O painel detecta e salva a sessão."
                  : "Complete o login na tela abaixo. Quando entrar, o painel detecta e salva a sessão."}
              </p>
              {remoteSession.displayMode === "novnc" && remoteSession.novncUrl ? (
                <iframe
                  title="Login remoto noVNC"
                  src={remoteSession.novncUrl}
                  className="bg-muted h-[520px] w-full rounded-lg border"
                  allow="clipboard-read; clipboard-write"
                />
              ) : (
                <Alert>
                  <AlertTitle>Login na janela local</AlertTitle>
                  <AlertDescription>
                    noVNC só sobe com Docker (`docker compose up`). Sem Docker
                    neste Mac, o Chromium abre como janela do sistema — use essa
                    janela para entrar.
                  </AlertDescription>
                </Alert>
              )}
              <div className="text-muted-foreground flex items-center gap-2 text-sm">
                <Spinner data-icon="inline-start" />
                Aguardando login…
              </div>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
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
                  <>
                    <Button
                      onClick={() => handleRemoteConnect("linkedin")}
                      disabled={startingProvider !== null}
                    >
                      {startingProvider === "linkedin" ? (
                        <Spinner data-icon="inline-start" />
                      ) : (
                        <Link2Icon data-icon="inline-start" />
                      )}
                      {startingProvider === "linkedin"
                        ? "Aguardando login…"
                        : "Conectar via tela remota"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="self-start"
                      onClick={() =>
                        setShowCookieFallback((s) => ({
                          ...s,
                          linkedin: !s.linkedin,
                        }))
                      }
                    >
                      {showCookieFallback.linkedin
                        ? "Ocultar fallback de cookies"
                        : "Fallback: importar cookies (se o IP for bloqueado)"}
                    </Button>
                    {showCookieFallback.linkedin ? (
                      <>
                        <FieldGroup>
                          <Field>
                            <FieldLabel htmlFor="linkedin-cookies">
                              Cookies
                            </FieldLabel>
                            <Textarea
                              id="linkedin-cookies"
                              value={linkedinCookies}
                              onChange={(e) => setLinkedinCookies(e.target.value)}
                              placeholder="li_at=AQED..."
                              className="font-mono text-xs"
                            />
                            <FieldDescription>
                              DevTools → Cookies → li_at (HttpOnly).
                            </FieldDescription>
                          </Field>
                        </FieldGroup>
                        <Button
                          variant="outline"
                          onClick={() => handleImportCookies("linkedin")}
                          disabled={
                            startingProvider !== null || connectMutation.isPending
                          }
                        >
                          Importar cookies
                        </Button>
                      </>
                    ) : null}
                  </>
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
                  <>
                    <Button
                      onClick={() => handleRemoteConnect("indeed")}
                      disabled={startingProvider !== null}
                    >
                      {startingProvider === "indeed" ? (
                        <Spinner data-icon="inline-start" />
                      ) : (
                        <Link2Icon data-icon="inline-start" />
                      )}
                      {startingProvider === "indeed"
                        ? "Aguardando login…"
                        : "Conectar via tela remota"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="self-start"
                      onClick={() =>
                        setShowCookieFallback((s) => ({
                          ...s,
                          indeed: !s.indeed,
                        }))
                      }
                    >
                      {showCookieFallback.indeed
                        ? "Ocultar fallback de cookies"
                        : "Fallback: importar cookies"}
                    </Button>
                    {showCookieFallback.indeed ? (
                      <>
                        <FieldGroup>
                          <Field>
                            <FieldLabel htmlFor="indeed-cookies">
                              Cookies
                            </FieldLabel>
                            <Textarea
                              id="indeed-cookies"
                              value={indeedCookies}
                              onChange={(e) => setIndeedCookies(e.target.value)}
                              placeholder="PP=...; CTK=..."
                              className="font-mono text-xs"
                            />
                          </Field>
                        </FieldGroup>
                        <Button
                          variant="outline"
                          onClick={() => handleImportCookies("indeed")}
                          disabled={
                            startingProvider !== null || connectMutation.isPending
                          }
                        >
                          Importar cookies
                        </Button>
                      </>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          )}
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
                  checked={
                    allSelected ? true : someSelected ? "indeterminate" : false
                  }
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
                selectedEasyApplyCount === 0 ||
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
                : `Inscrever Easy Apply (${selectedEasyApplyCount})`}
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
              Remover selecionadas ({selectedIds.length})
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDeleteAll}
              disabled={
                allIds.length === 0 || deleteSelectedMutation.isPending
              }
            >
              <Trash2Icon data-icon="inline-start" />
              Remover todas
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
                <Button onClick={() => handleRemoteConnect("linkedin")}>
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
            const easyApply = isEasyApplyJob(item);
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
                          {!easyApply
                            ? " · inscrição automática só em Easy Apply"
                            : ""}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{item.matchScore}% match</Badge>
                      <StatusBadge status={item.status} />
                      <Badge variant="secondary">{item.job.source}</Badge>
                      {item.job.source === "LINKEDIN" ? (
                        <Badge
                          variant={item.job.easyApply ? "default" : "outline"}
                        >
                          {item.job.easyApply === true
                            ? "Easy Apply - Yes"
                            : item.job.easyApply === false
                              ? "Externa"
                              : "Easy Apply - No"}
                        </Badge>
                      ) : null}
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
