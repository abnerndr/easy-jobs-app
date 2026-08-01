# Easy Job App — Sub-projeto A: Fundação

**Data:** 2026-07-30
**Status:** Aprovado para plano de implementação

## Contexto geral do produto

Plataforma que aplica de forma autônoma para vagas de tecnologia (foco em devs) no
LinkedIn, Indeed e InfoJobs. O usuário cria um perfil com critérios de busca, o sistema
encontra vagas compatíveis, tenta se auto-inscrever nas vagas com fluxo simplificado
("easy apply") e devolve pro usuário as que redirecionam pra outro site. Toda aplicação
feita fica registrada num histórico.

Projeto grande demais para uma spec única — foi decomposto em 5 sub-projetos
independentes, cada um com seu próprio ciclo spec → plano → implementação:

- **A. Fundação** (este documento) — schema base, auth, perfil do usuário, setup do projeto.
- **B. Ingestão de vagas** — conectores LinkedIn/Indeed/InfoJobs, fila Redis, normalização, dedup.
- **C. IA matching** — abstração Gemini/OpenAI/Claude, score de aderência vaga-perfil.
- **D. Auto-apply** — Playwright faz "easy apply", detecta redirect externo, grava histórico.
- **E. Dashboard** — feed de vagas, fila de aplicação manual, histórico de aplicações.

Ordem de execução: A → B → C/D → E.

Stack definida pelo usuário: Postgres, Redis (fila), Next.js + Node (backend), Prisma,
TanStack Query, Zod, React Hook Form, shadcn/ui, Zustand, Playwright.

Multi-usuário desde o início (não é ferramenta de uso pessoal único).

Deploy self-hosted via Coolify do usuário.

⚠️ **Aviso de escopo (B/D):** automatizar login e envio de candidaturas no LinkedIn e
Indeed viola os Termos de Serviço dessas plataformas e pode levar a bloqueio de conta.
Isso é aceitável para construir (uso da própria conta do usuário, sem ataque a terceiros),
mas o design de B/D precisa tratar rate-limiting, sessão própria do usuário (não
credenciais roubadas de terceiros) e, em casos sensíveis, confirmação manual antes de
enviar. Detalhar nas specs de B e D.

## Escopo deste documento (Sub-projeto A)

Dentro: setup do projeto, autenticação, criação/edição de perfil (critérios de busca +
currículo), infraestrutura de dev/deploy.

Fora (fica para B/C/D/E): busca de vagas, matching por IA, automação de candidatura,
dashboard de vagas encontradas/histórico. A área `(app)` desta fase só precisa de uma
página de perfil funcional; dashboard fica como stub/placeholder.

## 1. Arquitetura

Next.js App Router full-stack (sem backend separado):

- `app/api/**/route.ts` — backend Node, Prisma usado diretamente dentro dos handlers.
- `app/(auth)/login`, `app/(auth)/signup` — páginas públicas de autenticação.
- `app/(app)/profile`, `app/(app)/dashboard` (stub) — área logada.
- `lib/prisma.ts` — Prisma Client singleton.
- `lib/auth.ts` — configuração do Auth.js.
- `lib/schemas/*.ts` — Zod schemas compartilhados entre client (resolver do RHF) e
  server (validação no route handler) — uma única fonte de verdade por entidade.
- `components/ui` — shadcn/ui.
- `stores/*.ts` — Zustand, só para estado de UI (client-only), nunca para dados de
  servidor (isso é papel do TanStack Query).
- `prisma/schema.prisma` — schema do banco.
- `docker-compose.yml` + `Dockerfile` — Postgres + Redis + app para dev local; mesma
  base serve o deploy no Coolify do usuário.

Padrão de dados escolhido (dentre 3 avaliados): **API-first** — toda leitura/escrita
client-side passa por Route Handlers + TanStack Query, em vez de Server Components
buscando direto ou Server Actions. Um padrão único do início ao fim, mais fácil de
manter ao longo de várias fases (B–E) do que misturar RSC-first ou um híbrido.

⚠️ **Next.js 16 é posterior ao corte de treinamento do modelo — pode ter breaking
changes relevantes.** Antes de escrever qualquer código desta fase: rodar
`yarn install` e ler `node_modules/next/dist/docs/` para confirmar a convenção atual de
route handlers, middleware e auth route (pode ter mudado em relação ao Next.js
conhecido). Isso é requisito do `AGENTS.md` do projeto, não apenas recomendação.

## 2. Modelo de dados (Prisma)

```prisma
model User {
  id            String    @id @default(cuid())
  email         String    @unique
  passwordHash  String?   // null se criado via OAuth
  name          String?
  image         String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  accounts      Account[]
  sessions      Session[]
  profile       Profile?
  resume        Resume?
}

// Account, Session, VerificationToken: tabelas padrão do Auth.js Prisma Adapter.

enum Seniority {
  JUNIOR
  PLENO
  SENIOR
  ESPECIALISTA
}

enum WorkMode {
  REMOTO
  HIBRIDO
  PRESENCIAL
}

enum ContractType {
  CLT
  PJ
  FREELANCE
  ESTAGIO
}

model Profile {
  id            String         @id @default(cuid())
  userId        String         @unique
  user          User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  jobTitles     String[]       // ex: ["Desenvolvedor Backend Node", "Frontend React"]
  seniority     Seniority
  techStack     String[]       // ex: ["React", "Node", "PostgreSQL"]
  location      String
  workMode      WorkMode
  salaryMin     Int?           // menor salário mensal aceitável, em reais (BRL), valor cheio sem centavos
  contractTypes ContractType[]
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt
}

model Resume {
  id         String   @id @default(cuid())
  userId     String   @unique // 1 currículo por usuário nesta fase; múltiplos fica para depois, se necessário
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  fileName   String
  filePath   String   // caminho relativo dentro do volume persistente
  mimeType   String
  size       Int
  uploadedAt DateTime @default(now())
}
```

## 3. Autenticação

Auth.js (NextAuth) + Prisma Adapter, sessão em banco (revogável, não JWT stateless).
Providers: Credentials (email + senha, hash bcrypt) e Google OAuth.

- Signup: cria `User` com `passwordHash`. Login: compara hash.
- Login Google: Adapter cria `User` automaticamente (sem `passwordHash`).
- Rotas sob `app/(app)/**` exigem sessão válida; sem sessão, redirect para `/login`.
- Sem verificação de e-mail nesta fase (não há serviço de e-mail configurado ainda).
  Pode ser adicionado depois (ex: Resend) sem mudar o modelo de dados.

## 4. Fluxo de dados

**Perfil:** formulário (RHF + Zod + shadcn) → `useMutation` (TanStack Query) →
`POST/PUT /api/profile` → Zod valida de novo no server (mesmo schema do client) →
`prisma.profile.upsert`.

**Currículo:** upload multipart → `POST /api/resumes` → arquivo salvo em volume Docker
persistente e **nomeado** (ex: `/data/resumes/{userId}/{uuid}.pdf`) — precisa ser named
volume no `docker-compose.yml`, senão o arquivo some a cada redeploy no Coolify →
caminho relativo salvo no banco. Download só via endpoint autenticado que faz stream do
arquivo (o `filePath` nunca é exposto como URL pública direta).

## 5. Tratamento de erros

- Falha de validação Zod → `400 { error: { field, message } }`; RHF exibe inline.
- Falha de auth → mensagem genérica (não revelar se o e-mail existe, evita user
  enumeration).
- Route handlers com try/catch, log no server, resposta padronizada de erro
  (`{ error: string }`) e status HTTP condizente (400/401/403/404/500).

## 6. Testes

- Vitest para schemas Zod e utils.
- Playwright (já é dependência do projeto, será reaproveitado nas fases B/D) cobre o
  caminho crítico e2e: signup → login → criar perfil → upload de currículo.
- Repositório não tem nenhum teste hoje — este é o baseline de cobertura do projeto.

## Decisões tomadas durante o brainstorming

| Decisão | Escolha |
|---|---|
| Multi-usuário? | Sim, desde o início |
| Método de login | Email/senha + Google OAuth |
| Infra/deploy | Docker Compose local; deploy via Coolify do usuário |
| Storage de currículo | Disco local/volume nomeado (não S3/MinIO por ora) |
| Padrão de dados | API-first (Route Handlers + TanStack Query) |
