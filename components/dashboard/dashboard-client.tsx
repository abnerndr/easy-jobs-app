"use client";

import { useState } from "react";
import Link from "next/link";
import {
  BriefcaseIcon,
  ExternalLinkIcon,
  HeartIcon,
  Link2Icon,
  SearchIcon,
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
  useClearDemoJobsMutation,
  useConnectBoardMutation,
  useConnectionsQuery,
  useDeleteSelectedJobsMutation,
  useDisconnectBoardMutation,
  useJobSearchMutation,
  useJobSettingsQuery,
  useJobsQuery,
  useMatchSelectedJobsMutation,
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
  const matchSelectedMutation = useMatchSelectedJobsMutation();
  const saveSettings = useSaveJobSettingsMutation();
  const connectMutation = useConnectBoardMutation();
  const disconnectMutation = useDisconnectBoardMutation();

  const [limitDraft, setLimitDraft] = useState<string | null>(null);
  const [minMatchDraft, setMinMatchDraft] = useState<string | null>(null);
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
  const minMatchValue =
    minMatchDraft ?? String(settings?.minMatchScore ?? 50);
  const usedToday = usage?.usedToday ?? 0;
  const dailyLimit = settings?.dailyApplyLimit ?? 10;
  const remainingToday = usage?.remainingToday ?? 0;
  const progressValue =
    dailyLimit > 0 ? Math.min(100, Math.round((usedToday / dailyLimit) * 100)) : 0;
  const atLimit = remainingToday === 0;

  async function handleSaveSettings() {
    const dailyApplyLimit = Number(limitValue);
    const minMatchScore = Number(minMatchValue);
    if (!Number.isFinite(dailyApplyLimit) || !Number.isInteger(dailyApplyLimit)) {
      toast.error("Informe um limite diário inteiro válido.");
      return;
    }
    if (
      !Number.isFinite(minMatchScore) ||
      !Number.isInteger(minMatchScore) ||
      minMatchScore < 0 ||
      minMatchScore > 100
    ) {
      toast.error("Informe um match mínimo inteiro entre 0 e 100.");
      return;
    }
    try {
      await saveSettings.mutateAsync({
        dailyApplyLimit,
        minMatchScore,
        autoQueue: settings?.autoQueue ?? true,
      });
      setLimitDraft(null);
      setMinMatchDraft(null);
      toast.success("Configurações atualizadas.");
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

  async function handleConnect(provider: "linkedin" | "indeed") {
    setStartingProvider(provider);
    toast.message(
      `Abrindo Chrome local (${provider === "linkedin" ? "LinkedIn" : "Indeed"})…`,
      {
        description:
          "Uma janela do Chrome vai abrir neste computador. Faça login lá e aguarde a confirmação aqui.",
      }
    );
    try {
      const result = await connectMutation.mutateAsync({
        provider,
        mode: "browser",
      });
      void connectionsQuery.refetch();
      toast.success(result.message ?? "Conectado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao conectar.");
      setShowCookieFallback((s) => ({ ...s, [provider]: true }));
    } finally {
      setStartingProvider(null);
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

  async function handleMatchSelected() {
    if (selectedIds.length === 0) {
      toast.error("Selecione ao menos uma vaga.");
      return;
    }
    try {
      const result = await matchSelectedMutation.mutateAsync(selectedIds);
      if (result.updated === 0) {
        toast.warning(result.message);
        return;
      }
      setSelectedIds([]);
      toast.success(result.message);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Erro ao dar match."
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
            Conecte LinkedIn e/ou Indeed pelo Chrome deste computador, busque
            vagas reais e dê match nas que fizerem sentido. Candidatura
            automática (Easy Apply) volta em breve.
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
            Uma janela do Chrome abre neste computador. Faça login nela — o
            painel detecta e salva a sessão automaticamente.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
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
                    onClick={() => handleConnect("linkedin")}
                    disabled={startingProvider !== null}
                  >
                    {startingProvider === "linkedin" ? (
                      <Spinner data-icon="inline-start" />
                    ) : (
                      <Link2Icon data-icon="inline-start" />
                    )}
                    {startingProvider === "linkedin"
                      ? "Aguardando login…"
                      : "Conectar (Chrome local)"}
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
                      ? "Ocultar avançado"
                      : "Avançado: importar cookies"}
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
                    onClick={() => handleConnect("indeed")}
                    disabled={startingProvider !== null}
                  >
                    {startingProvider === "indeed" ? (
                      <Spinner data-icon="inline-start" />
                    ) : (
                      <Link2Icon data-icon="inline-start" />
                    )}
                    {startingProvider === "indeed"
                      ? "Aguardando login…"
                      : "Conectar (Chrome local)"}
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
                      ? "Ocultar avançado"
                      : "Avançado: importar cookies"}
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
            <CardTitle>Configurações de busca</CardTitle>
            <CardDescription>
              Limite diário e filtro de compatibilidade com seu perfil.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field orientation="horizontal">
                <FieldLabel htmlFor="daily-limit">Limite diário</FieldLabel>
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
                Quantas vagas podem entrar na fila por dia (1–100). Padrão: 10.
              </FieldDescription>
              <Field orientation="horizontal">
                <FieldLabel htmlFor="min-match">Match mínimo (%)</FieldLabel>
                <Input
                  id="min-match"
                  type="number"
                  min={0}
                  max={100}
                  value={minMatchValue}
                  onChange={(e) => setMinMatchDraft(e.target.value)}
                  className="max-w-28"
                />
              </Field>
              <FieldDescription>
                Só entram vagas com match igual ou acima deste percentual após a
                busca. Padrão: 50%.
              </FieldDescription>
            </FieldGroup>
          </CardContent>
          <CardFooter>
            <Button
              variant="outline"
              onClick={handleSaveSettings}
              disabled={saveSettings.isPending}
            >
              {saveSettings.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Settings2Icon data-icon="inline-start" />
              )}
              Salvar configurações
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
              variant="secondary"
              onClick={handleMatchSelected}
              disabled={
                selectedIds.length === 0 || matchSelectedMutation.isPending
              }
            >
              {matchSelectedMutation.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <HeartIcon data-icon="inline-start" />
              )}
              {matchSelectedMutation.isPending
                ? "Marcando match…"
                : `Dar match nas selecionadas (${selectedIds.length})`}
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
                <Button
                  onClick={() => handleConnect("linkedin")}
                  disabled={startingProvider !== null}
                >
                  {startingProvider === "linkedin" ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <Link2Icon data-icon="inline-start" />
                  )}
                  {startingProvider === "linkedin"
                    ? "Aguardando login…"
                    : "Conectar LinkedIn"}
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
                      {item.job.source === "LINKEDIN" &&
                      item.job.easyApply === true ? (
                        <Badge variant="outline">Easy Apply</Badge>
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
