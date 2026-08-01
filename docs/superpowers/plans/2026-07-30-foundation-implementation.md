# Foundation (Sub-projeto A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Next.js + Postgres + Prisma foundation for the job-application platform: project/infra scaffolding, email+Google auth, and a user profile (search criteria + résumé) that later sub-projects (job ingestion, AI matching, auto-apply, dashboard) build on.

**Architecture:** Next.js 16 App Router as a full-stack app — Route Handlers under `app/api/**` as the backend (Prisma inside), TanStack Query + RHF + Zod on the client, shadcn/ui for components, Zustand for client-only UI state. Auth.js v5 (beta) with Credentials + Google, JWT sessions. Prisma 7 with the `@prisma/adapter-pg` driver adapter (no native engine binary).

**Tech Stack:** Next.js 16.2.12, React 19, TypeScript, Prisma 7.9.1 (+ `@prisma/adapter-pg`, `pg`), PostgreSQL 17, `next-auth@5.0.0-beta.32` (+ `@auth/prisma-adapter`), `bcryptjs`, Zod 4, React Hook Form, `@tanstack/react-query` v5, Zustand v5, shadcn/ui (Tailwind v4), Vitest, Playwright.

**Baseline verified against installed packages, not training data (per `AGENTS.md`):**
- Next.js 16 renamed Middleware to **Proxy** (`proxy.ts`); Route Handler (`route.ts`) conventions are unchanged. This plan does not use `proxy.ts` at all — see Task 9 for why (DAL-only auth checks, deliberately).
- `next-auth`'s `latest` dist-tag is still v4 (legacy). This plan pins **`next-auth@beta`** (5.0.0-beta.32) to get the App Router-native API (`handlers`/`auth`/`signIn`/`signOut`).
- Auth.js forces **JWT session strategy** whenever a Credentials provider is present (confirmed via `@auth/core/errors.d.ts`, `MissingAdapterMethods`/`CredentialsSignin` docs) — this **deviates from the approved design spec**, which said "sessão em banco". Database sessions and Credentials are mutually exclusive in Auth.js; every production Auth.js app that mixes Credentials with OAuth uses JWT sessions. The Prisma adapter is still wired up (needed so Google sign-in creates/links `User`/`Account` rows); only the `Session` table goes unused.
- **Prisma 7** is a major departure from Prisma 5/6: `datasource.url` no longer lives in `schema.prisma` (moved to `prisma.config.ts`), the client generator requires an explicit `output` path (generates outside `node_modules`), and `PrismaClient` requires an explicit driver adapter (`@prisma/adapter-pg` + `pg`) — there is no more zero-config native engine binary. `prisma migrate dev` no longer auto-runs `prisma generate`; every migration step in this plan runs both explicitly.
- Redis is **intentionally not included** in this sub-project's `docker-compose.yml` — nothing in Sub-project A touches a queue. It gets added in Sub-project B when the job-ingestion queue is built.
- **Two environment-specific fixes discovered while verifying Task 2, applied retroactively to Task 1's and Task 8's file contents below:** (1) this worktree lives inside a parent checkout that also has a `yarn.lock`, which makes Turbopack misdetect the project root and silently 404 every route — `next.config.ts` pins `turbopack.root` to fix it; (2) `next/font/google` (Geist/Geist_Mono, the create-next-app default) fails to compile under this sandbox's network conditions, turning every route into a 500 — `app/layout.tsx`/`app/globals.css` use a system font stack instead. Both are reflected in the task steps below, not just patched ad hoc.

---

## Task 1: Docker Compose, env files, Next.js standalone output

**Files:**
- Create: `docker-compose.yml`
- Create: `.env.example`
- Create: `.env` (local only, gitignored)
- Modify: `.gitignore`
- Modify: `next.config.ts`

- [ ] **Step 1: Add local Postgres via Docker Compose**

Create `docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: easy_job_app
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

This is for **local dev only** — `yarn dev` runs on the host and connects to `localhost:5432`. The app itself is not containerized for dev; the `Dockerfile` added in Task 13 is for the Coolify deploy target only.

- [ ] **Step 2: Start Postgres and verify it's reachable**

Run: `docker compose up -d`
Expected: `docker compose ps` shows the `postgres` service as `running (healthy)` or `Up`.

Run: `docker compose exec postgres pg_isready -U postgres`
Expected: `/var/run/postgresql:5432 - accepting connections`

- [ ] **Step 3: Add env files**

Create `.env.example`:

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/easy_job_app?schema=public"

# Generate with: openssl rand -base64 32
AUTH_SECRET="replace-me"
AUTH_URL="http://localhost:3000"

AUTH_GOOGLE_ID=""
AUTH_GOOGLE_SECRET=""

# Absolute or relative path where uploaded résumés are stored.
# In Coolify, mount a persistent volume at this path or the files
# vanish on every redeploy.
RESUME_STORAGE_DIR="./data/resumes"
```

Create `.env` (copy of the above with a real generated secret):

Run: `openssl rand -base64 32`
Copy the output into `.env`'s `AUTH_SECRET`. Leave `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` blank for now (Google login simply won't work until a Google OAuth app is created — Credentials login doesn't need them). Otherwise `.env` matches `.env.example` with `DATABASE_URL` pointing at the Compose Postgres.

- [ ] **Step 4: Update `.gitignore`**

Add to the end of `.gitignore`:

```gitignore

# local file storage (résumés)
/data

# prisma 7 generated client (regenerated via `prisma generate`)
/generated

# playwright
/test-results/
/playwright-report/
/blob-report/
/playwright/.cache/

# brainstorming visual companion (superpowers skill)
.superpowers/
```

- [ ] **Step 5: Switch Next.js to standalone output (for the Task 13 Dockerfile), pin Turbopack's root**

Edit `next.config.ts`:

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // This worktree sits inside a parent checkout that also has a yarn.lock,
  // which makes Turbopack misdetect the project root. Pin it explicitly.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
```

(If this project is ever moved out of a nested worktree, `turbopack.root` becomes a no-op — safe to leave in either way.)

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml .env.example .gitignore next.config.ts
git commit -m "chore: add local Postgres compose, env files, standalone output"
```

(`.env` is gitignored and won't be staged — confirm with `git status` that it's absent from the diff.)

---

## Task 2: Prisma schema, config, and client singleton

**Files:**
- Create: `prisma/schema.prisma`
- Create: `prisma.config.ts`
- Create: `lib/prisma.ts`

- [ ] **Step 1: Write the Prisma schema**

Create `prisma/schema.prisma`:

```prisma
generator client {
  provider     = "prisma-client"
  output       = "../generated/prisma"
  // Pinned to CommonJS: this project's package.json has no "type": "module",
  // and Prisma 7's client is ESM by default. Forcing cjs here avoids flipping
  // the whole project to ESM just to satisfy the generated client.
  moduleFormat = "cjs"
}

datasource db {
  provider = "postgresql"
}

model User {
  id            String    @id @default(cuid())
  name          String?
  email         String    @unique
  // Required by Auth.js's AdapterUser type even though this project doesn't
  // implement email verification yet — always null for now.
  emailVerified DateTime?
  image         String?
  passwordHash  String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  accounts Account[]
  sessions Session[]
  profile  Profile?
  resume   Resume?
}

model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String? @db.Text
  access_token      String? @db.Text
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String? @db.Text
  session_state     String?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
}

// Unused at runtime (sessions are JWT, see auth.ts), but required so the
// Prisma Client shape matches what @auth/prisma-adapter's PrismaAdapter()
// expects (it always calls p.session.*, even though Auth.js never invokes
// those adapter methods under the "jwt" strategy).
model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model VerificationToken {
  identifier String
  token      String
  expires    DateTime

  @@unique([identifier, token])
}

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
  jobTitles     String[]
  seniority     Seniority
  techStack     String[]
  location      String
  workMode      WorkMode
  salaryMin     Int?
  contractTypes ContractType[]
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt
}

model Resume {
  id         String   @id @default(cuid())
  userId     String   @unique
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  fileName   String
  filePath   String
  mimeType   String
  size       Int
  uploadedAt DateTime @default(now())
}
```

- [ ] **Step 2: Write `prisma.config.ts`**

Create `prisma.config.ts` (project root, next to `package.json`):

```typescript
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
```

- [ ] **Step 3: Run the first migration and generate the client**

Run: `./node_modules/.bin/prisma migrate dev --name init`
Expected: `Your database is now in sync with your schema.` and a new folder under `prisma/migrations/`.

Run: `./node_modules/.bin/prisma generate`
Expected: `Generated Prisma Client` pointing at `generated/prisma`.

(Prisma 7 no longer auto-generates after `migrate dev` — both commands are required every time the schema changes. Use `./node_modules/.bin/prisma` directly if a shell alias/hook rewrites bare `npx`/`prisma` invocations.)

- [ ] **Step 4: Prisma Client singleton**

Create `lib/prisma.ts`:

```typescript
import { Prisma, PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

export { Prisma };

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
```

- [ ] **Step 5: Verify the client works end to end**

The generated client is TypeScript with extensionless internal imports (e.g. `client.ts` imports from `./enums`) — that's fine for Next.js's bundler but means a plain `node -e "require(...)"` script **cannot** run it directly (neither CommonJS `require` nor `--experimental-strip-types` resolves those imports outside a bundler). Verify through Next.js itself instead, via a throwaway route:

Create `app/api/devcheck/route.ts` (name matters: a leading underscore, e.g. `_devcheck`, makes Next.js treat the folder as private and it silently won't route at all):

```typescript
import { prisma } from "@/lib/prisma";

export async function GET() {
  const count = await prisma.user.count();
  return Response.json({ userCount: count });
}
```

Run: `yarn dev` (background), then `curl -s http://localhost:3000/api/devcheck`
Expected: `{"userCount":0}`.

Stop the dev server and delete `app/api/devcheck/` — it was only for this check.

- [ ] **Step 6: Commit**

```bash
git add prisma.config.ts prisma/schema.prisma prisma/migrations lib/prisma.ts
git commit -m "feat: add Prisma schema, config, and client singleton"
```

(`generated/` stays untracked per the Task 1 `.gitignore` entry — confirm with `git status`.)

---

## Task 3: Zod schemas (auth + profile) with Vitest

**Files:**
- Create: `vitest.config.ts`
- Create: `tests/setup.ts`
- Create: `lib/schemas/auth.ts`
- Create: `lib/schemas/profile.ts`
- Test: `tests/unit/schemas.test.ts`
- Modify: `package.json` (scripts)

- [ ] **Step 1: Vitest config**

Create `vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
  },
});
```

Create `tests/setup.ts`:

```typescript
import "@testing-library/jest-dom/vitest";
```

Add to `package.json` `scripts`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 2: Write the failing tests**

Create `tests/unit/schemas.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { loginSchema, signupSchema } from "@/lib/schemas/auth";
import { profileSchema } from "@/lib/schemas/profile";

describe("signupSchema", () => {
  it("accepts a valid signup payload", () => {
    const result = signupSchema.safeParse({
      name: "Ana Dev",
      email: "ana@example.com",
      password: "abc12345",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a password without a number", () => {
    const result = signupSchema.safeParse({
      name: "Ana Dev",
      email: "ana@example.com",
      password: "abcdefgh",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid email", () => {
    const result = signupSchema.safeParse({
      name: "Ana Dev",
      email: "not-an-email",
      password: "abc12345",
    });
    expect(result.success).toBe(false);
  });

  it("normalizes email to lowercase", () => {
    const result = signupSchema.safeParse({
      name: "Ana Dev",
      email: "Ana@Example.COM",
      password: "abc12345",
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.email).toBe("ana@example.com");
  });

  it("rejects a password longer than 72 characters", () => {
    const result = signupSchema.safeParse({
      name: "Ana Dev",
      email: "ana@example.com",
      password: "a1".repeat(40),
    });
    expect(result.success).toBe(false);
  });
});

describe("loginSchema", () => {
  it("rejects an empty password", () => {
    const result = loginSchema.safeParse({ email: "ana@example.com", password: "" });
    expect(result.success).toBe(false);
  });

  it("normalizes email to lowercase", () => {
    const result = loginSchema.safeParse({ email: "Ana@Example.COM", password: "x" });
    expect(result.success).toBe(true);
    expect(result.success && result.data.email).toBe("ana@example.com");
  });
});

describe("profileSchema", () => {
  const validProfile = {
    jobTitles: ["Desenvolvedor Backend Node"],
    seniority: "PLENO",
    techStack: ["Node", "PostgreSQL"],
    location: "São Paulo, SP",
    workMode: "REMOTO",
    contractTypes: ["CLT", "PJ"],
  };

  it("accepts a valid profile", () => {
    expect(profileSchema.safeParse(validProfile).success).toBe(true);
  });

  it("rejects an empty jobTitles list", () => {
    const result = profileSchema.safeParse({ ...validProfile, jobTitles: [] });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid seniority value", () => {
    const result = profileSchema.safeParse({ ...validProfile, seniority: "STAGIAIRE" });
    expect(result.success).toBe(false);
  });

  it("accepts a profile without salaryMin (optional)", () => {
    const { salaryMin: _unused, ...withoutSalary } = { ...validProfile, salaryMin: 8000 };
    expect(profileSchema.safeParse(withoutSalary).success).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests, confirm they fail**

Run: `yarn test`
Expected: FAIL — `Cannot find module '@/lib/schemas/auth'` (files don't exist yet).

- [ ] **Step 4: Implement the schemas**

Create `lib/schemas/auth.ts`:

```typescript
import * as z from "zod";

export const signupSchema = z.object({
  name: z.string().min(2, { error: "Nome deve ter pelo menos 2 caracteres." }).trim(),
  email: z
    .email({ error: "Informe um email válido." })
    .trim()
    .toLowerCase(),
  password: z
    .string()
    .min(8, { error: "Senha deve ter pelo menos 8 caracteres." })
    .max(72, { error: "Senha deve ter no máximo 72 caracteres." })
    .regex(/[a-zA-Z]/, { error: "Senha deve conter ao menos uma letra." })
    .regex(/[0-9]/, { error: "Senha deve conter ao menos um número." }),
});

export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: z
    .email({ error: "Informe um email válido." })
    .trim()
    .toLowerCase(),
  password: z.string().min(1, { error: "Senha é obrigatória." }).max(72, {
    error: "Senha deve ter no máximo 72 caracteres.",
  }),
});

export type LoginInput = z.infer<typeof loginSchema>;
```

Create `lib/schemas/profile.ts`:

```typescript
import * as z from "zod";

export const SENIORITY_VALUES = ["JUNIOR", "PLENO", "SENIOR", "ESPECIALISTA"] as const;
export const WORK_MODE_VALUES = ["REMOTO", "HIBRIDO", "PRESENCIAL"] as const;
export const CONTRACT_TYPE_VALUES = ["CLT", "PJ", "FREELANCE", "ESTAGIO"] as const;

export const profileSchema = z.object({
  jobTitles: z
    .array(z.string().trim().min(1))
    .min(1, { error: "Informe ao menos um cargo desejado." }),
  seniority: z.enum(SENIORITY_VALUES, { error: "Selecione a senioridade." }),
  techStack: z
    .array(z.string().trim().min(1))
    .min(1, { error: "Informe ao menos uma tecnologia." }),
  location: z.string().trim().min(2, { error: "Informe sua localização." }),
  workMode: z.enum(WORK_MODE_VALUES, { error: "Selecione a modalidade de trabalho." }),
  salaryMin: z.number().int().positive().optional(),
  contractTypes: z
    .array(z.enum(CONTRACT_TYPE_VALUES))
    .min(1, { error: "Selecione ao menos um tipo de contrato." }),
});

export type ProfileInput = z.infer<typeof profileSchema>;
```

- [ ] **Step 5: Run tests, confirm they pass**

Run: `yarn test`
Expected: `Test Files 1 passed`, `Tests 11 passed`.

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts tests/setup.ts tests/unit/schemas.test.ts lib/schemas package.json
git commit -m "test: add Zod schemas for auth and profile with Vitest"
```

---

## Task 4: Password hashing helper

**Files:**
- Create: `lib/password.ts`
- Test: `tests/unit/password.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/password.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/password";

describe("password hashing", () => {
  it("hashes a password and verifies it back", async () => {
    const hash = await hashPassword("correct-horse");
    expect(hash).not.toBe("correct-horse");
    expect(await verifyPassword("correct-horse", hash)).toBe(true);
  });

  it("rejects the wrong password", async () => {
    const hash = await hashPassword("correct-horse");
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, confirm it fails**

Run: `yarn test tests/unit/password.test.ts`
Expected: FAIL — `Cannot find module '@/lib/password'`.

- [ ] **Step 3: Implement**

Create `lib/password.ts`:

```typescript
import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
```

- [ ] **Step 4: Run test, confirm it passes**

Run: `yarn test tests/unit/password.test.ts`
Expected: `Tests 2 passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/password.ts tests/unit/password.test.ts
git commit -m "feat: add bcryptjs password hashing helper"
```

---

## Task 5: Auth.js configuration

**Files:**
- Create: `auth.ts`
- Create: `app/api/auth/[...nextauth]/route.ts`

- [ ] **Step 1: Write `auth.ts`**

Create `auth.ts` (project root — this is Auth.js's own convention, not an arbitrary choice):

```typescript
import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import { loginSchema } from "@/lib/schemas/auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Google,
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Senha", type: "password" },
      },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email },
        });
        if (!user?.passwordHash) return null;

        const isValid = await verifyPassword(parsed.data.password, user.passwordHash);
        if (!isValid) return null;

        return { id: user.id, email: user.email, name: user.name, image: user.image };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.id = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user) session.user.id = token.id as string;
      return session;
    },
  },
});
```

- [ ] **Step 2: Route handler**

Create `app/api/auth/[...nextauth]/route.ts`:

```typescript
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
```

- [ ] **Step 3: Verify the provider endpoint responds**

Run: `yarn dev` (leave running in the background)
Run: `curl -s http://localhost:3000/api/auth/providers`
Expected: JSON listing `google` and `credentials` providers. Stop the dev server after checking.

- [ ] **Step 4: Commit**

```bash
git add auth.ts app/api/auth
git commit -m "feat: configure Auth.js with Credentials and Google providers"
```

---

## Task 6: Signup API route

**Files:**
- Create: `lib/api-response.ts`
- Create: `app/api/auth/signup/route.ts`

- [ ] **Step 1: Shared API error-response helper**

Create `lib/api-response.ts`:

```typescript
import { NextResponse } from "next/server";
import type { ZodError } from "zod";

export function validationErrorResponse(error: ZodError) {
  const fieldErrors = error.flatten().fieldErrors as Record<string, string[] | undefined>;
  const [field, messages] =
    Object.entries(fieldErrors).find(([, msgs]) => msgs && msgs.length > 0) ?? [];

  return NextResponse.json(
    {
      error: {
        field: field ?? "unknown",
        message: messages?.[0] ?? "Dados inválidos.",
      },
    },
    { status: 400 }
  );
}

export function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}
```

- [ ] **Step 2: Signup route handler**

Create `app/api/auth/signup/route.ts`:

```typescript
import { Prisma, prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { signupSchema } from "@/lib/schemas/auth";
import { errorResponse, validationErrorResponse } from "@/lib/api-response";
import { NextResponse } from "next/server";

const DUPLICATE_EMAIL_MESSAGE = "Não foi possível criar a conta com esses dados.";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body) return errorResponse("Corpo da requisição inválido.", 400);

  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  try {
    const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (existing) {
      // Same message as "wrong password" flows would use — do not reveal
      // whether the email is already registered (avoids user enumeration).
      return errorResponse(DUPLICATE_EMAIL_MESSAGE, 409);
    }

    const passwordHash = await hashPassword(parsed.data.password);
    const user = await prisma.user.create({
      data: { name: parsed.data.name, email: parsed.data.email, passwordHash },
    });

    return NextResponse.json({ id: user.id, email: user.email, name: user.name }, { status: 201 });
  } catch (error) {
    // Two concurrent signups for the same email can both pass the
    // findUnique check above; the loser hits this unique constraint
    // instead. Same response either way.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return errorResponse(DUPLICATE_EMAIL_MESSAGE, 409);
    }

    console.error("signup failed", error);
    return errorResponse("Erro ao criar conta.", 500);
  }
}
```

- [ ] **Step 3: Verify manually**

Run: `yarn dev` (background), then:

```bash
curl -s -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"name":"Ana Dev","email":"ana@example.com","password":"abc12345"}'
```

Expected: `201` with `{"id":"...","email":"ana@example.com","name":"Ana Dev"}`.

Run the same command again.
Expected: `409` with `{"error":"Não foi possível criar a conta com esses dados."}`.

Stop the dev server after checking.

- [ ] **Step 4: Commit**

```bash
git add lib/api-response.ts app/api/auth/signup
git commit -m "feat: add signup API route"
```

---

## Task 7: shadcn/ui setup

**Files:**
- Create: `components.json` (generated)
- Create: `lib/utils.ts` (generated)
- Create: `components/ui/*` (generated)
- Modify: `app/globals.css` (generated)

- [ ] **Step 1: Initialize shadcn/ui**

Run: `npx shadcn@latest init`

Answers when prompted: base color — Neutral; CSS variables — Yes. It auto-detects Tailwind v4, TypeScript, and the `@/*` path alias already in `tsconfig.json`.

Expected: creates `components.json` and `lib/utils.ts`, and adds a `@theme`/CSS-variables block to `app/globals.css`.

- [ ] **Step 2: Add the components this sub-project needs**

Run: `npx shadcn@latest add button input label form card select checkbox sonner`

Expected: adds files under `components/ui/` (`button.tsx`, `input.tsx`, `label.tsx`, `form.tsx`, `card.tsx`, `select.tsx`, `checkbox.tsx`, `sonner.tsx`), plus their Radix/CVA dependencies to `package.json`.

- [ ] **Step 3: Wire the toaster into the root layout**

Edit `app/layout.tsx` — add the import and mount `<Toaster />` once, at the end of `<body>`:

```typescript
import { Toaster } from "@/components/ui/sonner";
```

```typescript
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster />
      </body>
```

- [ ] **Step 4: Verify the build still compiles**

Run: `yarn build`
Expected: build succeeds (this only proves the new components compile — pages don't use them yet).

- [ ] **Step 5: Commit**

```bash
git add components.json components/ui lib/utils.ts app/globals.css app/layout.tsx package.json yarn.lock
git commit -m "chore: initialize shadcn/ui"
```

---

## Task 8: Signup and login pages

**Files:**
- Create: `components/providers/query-provider.tsx`
- Modify: `app/layout.tsx`
- Create: `components/auth/signup-form.tsx`
- Create: `components/auth/login-form.tsx`
- Create: `app/(auth)/layout.tsx`
- Create: `app/(auth)/signup/page.tsx`
- Create: `app/(auth)/login/page.tsx`

- [ ] **Step 1: TanStack Query provider**

Create `components/providers/query-provider.tsx`:

```typescript
"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
```

- [ ] **Step 2: Wrap the root layout**

Edit `app/layout.tsx` — wrap `{children}` with `QueryProvider`, update `lang` and metadata. (No `next/font/google` here — Task 2 already replaced the create-next-app Geist fonts with a system font stack in `app/globals.css`, since Google Fonts fails to compile in this sandbox's network conditions.)

```typescript
import type { Metadata } from "next";
import { QueryProvider } from "@/components/providers/query-provider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Easy Job App",
  description: "Aplicação autônoma para vagas de tecnologia",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <QueryProvider>{children}</QueryProvider>
        <Toaster />
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Signup form**

Create `components/auth/signup-form.tsx`:

```typescript
"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { signIn } from "next-auth/react";
import { signupSchema, type SignupInput } from "@/lib/schemas/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

async function signup(input: SignupInput) {
  const response = await fetch("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error?.message ?? body?.error ?? "Erro ao criar conta.");
  }
  return body;
}

export function SignupForm() {
  const router = useRouter();
  const form = useForm<SignupInput>({
    resolver: zodResolver(signupSchema),
    defaultValues: { name: "", email: "", password: "" },
  });

  const mutation = useMutation({
    mutationFn: signup,
    onSuccess: async (_, variables) => {
      await signIn("credentials", {
        email: variables.email,
        password: variables.password,
        redirect: false,
      });
      toast.success("Conta criada com sucesso.");
      router.push("/profile");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
        className="space-y-4"
      >
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nome</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Senha</FormLabel>
              <FormControl>
                <Input type="password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={mutation.isPending}>
          {mutation.isPending ? "Criando conta..." : "Criar conta"}
        </Button>
      </form>
    </Form>
  );
}
```

- [ ] **Step 4: Login form**

Create `components/auth/login-form.tsx`:

```typescript
"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { toast } from "sonner";
import { loginSchema, type LoginInput } from "@/lib/schemas/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

export function LoginForm() {
  const router = useRouter();
  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: LoginInput) {
    const result = await signIn("credentials", {
      email: values.email,
      password: values.password,
      redirect: false,
    });

    if (result?.error) {
      toast.error("Email ou senha inválidos.");
      return;
    }

    router.push("/profile");
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Senha</FormLabel>
              <FormControl>
                <Input type="password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
          Entrar
        </Button>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => signIn("google", { callbackUrl: "/profile" })}
        >
          Entrar com Google
        </Button>
      </form>
    </Form>
  );
}
```

- [ ] **Step 5: Auth layout + pages**

Create `app/(auth)/layout.tsx`:

```typescript
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
```

Create `app/(auth)/signup/page.tsx`:

```typescript
import Link from "next/link";
import { SignupForm } from "@/components/auth/signup-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SignupPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Criar conta</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <SignupForm />
        <p className="text-center text-sm text-muted-foreground">
          Já tem conta?{" "}
          <Link href="/login" className="underline">
            Entrar
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
```

Create `app/(auth)/login/page.tsx`:

```typescript
import Link from "next/link";
import { LoginForm } from "@/components/auth/login-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function LoginPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Entrar</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <LoginForm />
        <p className="text-center text-sm text-muted-foreground">
          Ainda não tem conta?{" "}
          <Link href="/signup" className="underline">
            Criar conta
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 6: Verify manually in the browser**

Run: `yarn dev`, open `http://localhost:3000/signup`.
Expected: create an account with a new email → toast "Conta criada com sucesso." → redirected to `/profile` (will 404 or error until Task 9/10 exist — that's expected at this point, confirm the redirect itself happens).

Stop the dev server after checking.

- [ ] **Step 7: Commit**

```bash
git add components/providers components/auth "app/(auth)" app/layout.tsx
git commit -m "feat: add signup and login pages"
```

---

## Task 9: Session guard, app shell, Zustand store, dashboard stub

**Files:**
- Create: `lib/session.ts`
- Create: `stores/ui-store.ts`
- Create: `components/app-shell/topbar.tsx`
- Create: `components/app-shell/sidebar.tsx`
- Create: `components/app-shell/logout-button.tsx`
- Create: `app/(app)/layout.tsx`
- Create: `app/(app)/dashboard/page.tsx`

**Why no `proxy.ts`:** Next.js docs describe Proxy-based auth as an *optional* optimistic check, explicitly not a substitute for verifying the session close to the data source. This project verifies the session directly in the `(app)` layout (a Server Component) and inside every protected Route Handler — that alone is correct and complete, and it avoids depending on which JS runtime `proxy.ts` executes in (the bundled Next.js docs disagree with each other on whether Proxy defaults to Edge or Node in this version).

- [ ] **Step 1: Session helpers (DAL)**

Create `lib/session.ts`:

```typescript
import { redirect } from "next/navigation";
import { auth } from "@/auth";

/** For Server Components/layouts: redirects to /login if there's no session. */
export async function requireSession() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  return session;
}

/** For Route Handlers: returns null instead of redirecting (callers return 401 JSON). */
export async function requireApiSession() {
  const session = await auth();
  if (!session?.user) {
    return null;
  }
  return session;
}
```

- [ ] **Step 2: Zustand UI store**

Create `stores/ui-store.ts`:

```typescript
import { create } from "zustand";

interface UIState {
  isMobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
  toggleMobileNav: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  isMobileNavOpen: false,
  setMobileNavOpen: (open) => set({ isMobileNavOpen: open }),
  toggleMobileNav: () => set((state) => ({ isMobileNavOpen: !state.isMobileNavOpen })),
}));
```

- [ ] **Step 3: Logout button**

Create `components/app-shell/logout-button.tsx`:

```typescript
"use client";

import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";

export function LogoutButton() {
  return (
    <Button variant="ghost" onClick={() => signOut({ callbackUrl: "/login" })}>
      Sair
    </Button>
  );
}
```

- [ ] **Step 4: Sidebar (uses the Zustand store)**

Create `components/app-shell/sidebar.tsx`:

```typescript
"use client";

import Link from "next/link";
import { useUIStore } from "@/stores/ui-store";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Painel" },
  { href: "/profile", label: "Perfil" },
];

export function Sidebar() {
  const isOpen = useUIStore((state) => state.isMobileNavOpen);
  const setOpen = useUIStore((state) => state.setMobileNavOpen);

  return (
    <nav
      className={cn(
        "border-r bg-background w-56 shrink-0 p-4 space-y-1",
        "md:block",
        isOpen ? "block" : "hidden"
      )}
    >
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          onClick={() => setOpen(false)}
          className="block rounded-md px-3 py-2 text-sm hover:bg-accent"
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
```

- [ ] **Step 5: Topbar**

Create `components/app-shell/topbar.tsx`:

```typescript
"use client";

import { Button } from "@/components/ui/button";
import { LogoutButton } from "@/components/app-shell/logout-button";
import { useUIStore } from "@/stores/ui-store";

export function Topbar({ userName }: { userName: string | null | undefined }) {
  const toggleMobileNav = useUIStore((state) => state.toggleMobileNav);

  return (
    <header className="flex items-center justify-between border-b p-4">
      <Button variant="ghost" size="sm" className="md:hidden" onClick={toggleMobileNav}>
        Menu
      </Button>
      <span className="text-sm text-muted-foreground">{userName ?? "Minha conta"}</span>
      <LogoutButton />
    </header>
  );
}
```

- [ ] **Step 6: `(app)` layout with the session guard**

Create `app/(app)/layout.tsx`:

```typescript
import { requireSession } from "@/lib/session";
import { Sidebar } from "@/components/app-shell/sidebar";
import { Topbar } from "@/components/app-shell/topbar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <Topbar userName={session.user?.name} />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Dashboard stub**

Create `app/(app)/dashboard/page.tsx`:

```typescript
export default function DashboardPage() {
  return (
    <div>
      <h1 className="text-xl font-semibold">Painel</h1>
      <p className="text-muted-foreground">
        Em breve: vagas encontradas para o seu perfil. Por enquanto, complete seu{" "}
        <a href="/profile" className="underline">
          perfil
        </a>
        .
      </p>
    </div>
  );
}
```

- [ ] **Step 8: Verify the guard works**

Run: `yarn dev`. In an incognito/private browser window, visit `http://localhost:3000/dashboard` while signed out.
Expected: redirected to `/login` (no dashboard content flashes first).

Log in, visit `/dashboard` again.
Expected: renders with the sidebar, topbar showing your name, and the stub message.

Stop the dev server after checking.

- [ ] **Step 9: Commit**

```bash
git add lib/session.ts stores components/app-shell "app/(app)"
git commit -m "feat: add session guard, app shell, and dashboard stub"
```

---

## Task 10: Profile API and page

**Files:**
- Create: `app/api/profile/route.ts`
- Create: `hooks/use-profile.ts`
- Create: `components/profile/profile-form.tsx`
- Create: `app/(app)/profile/page.tsx`

- [ ] **Step 1: Profile API route (GET + PUT)**

Create `app/api/profile/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiSession } from "@/lib/session";
import { profileSchema } from "@/lib/schemas/profile";
import { errorResponse, validationErrorResponse } from "@/lib/api-response";

export async function GET() {
  const session = await requireApiSession();
  if (!session) return errorResponse("Não autenticado.", 401);

  try {
    const profile = await prisma.profile.findUnique({
      where: { userId: session.user.id },
    });

    return NextResponse.json({ profile });
  } catch (error) {
    console.error("profile fetch failed", error);
    return errorResponse("Erro ao carregar perfil.", 500);
  }
}

export async function PUT(request: Request) {
  const session = await requireApiSession();
  if (!session) return errorResponse("Não autenticado.", 401);

  const body = await request.json().catch(() => null);
  if (!body) return errorResponse("Corpo da requisição inválido.", 400);

  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  try {
    const profile = await prisma.profile.upsert({
      where: { userId: session.user.id },
      create: { ...parsed.data, userId: session.user.id },
      update: parsed.data,
    });

    return NextResponse.json({ profile });
  } catch (error) {
    console.error("profile save failed", error);
    return errorResponse("Erro ao salvar perfil.", 500);
  }
}
```

- [ ] **Step 2: TanStack Query hook**

Create `hooks/use-profile.ts`:

```typescript
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
```

- [ ] **Step 3: Profile form**

`jobTitles`/`techStack` are entered as comma-separated text in v1 (simplest possible input that still produces the `string[]` the schema expects) and split into arrays before validation. A proper tag-input component is cosmetic polish, not a Foundation concern — the underlying data model doesn't change either way.

Create `components/profile/profile-form.tsx`:

```typescript
"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  CONTRACT_TYPE_VALUES,
  SENIORITY_VALUES,
  WORK_MODE_VALUES,
  profileSchema,
  type ProfileInput,
} from "@/lib/schemas/profile";
import { useProfileQuery, useSaveProfileMutation } from "@/hooks/use-profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const EMPTY_VALUES: ProfileInput = {
  jobTitles: [],
  seniority: "PLENO",
  techStack: [],
  location: "",
  workMode: "REMOTO",
  salaryMin: undefined,
  contractTypes: [],
};

export function ProfileForm() {
  const { data: profile, isLoading, isError } = useProfileQuery();

  if (isLoading) return <p className="text-muted-foreground">Carregando perfil...</p>;

  // Don't fall through to an empty form on a failed load — profile would be
  // undefined either way, and PUT is a blind upsert, so silently rendering
  // "new profile" here could let a user overwrite a real saved profile they
  // just couldn't fetch.
  if (isError) {
    return (
      <p className="text-destructive">
        Erro ao carregar perfil. Recarregue a página para tentar novamente.
      </p>
    );
  }

  // Keyed on profile identity so this remounts fresh the one time real data
  // replaces EMPTY_VALUES (new profile -> "new", or once a saved profile
  // exists -> its id). useForm() only reads defaultValues on a component's
  // own first mount, so without a key change here <Select> would mount once
  // with EMPTY_VALUES's value and only get corrected via a reset() effect a
  // tick later — Radix Select's trigger display gets stuck showing the stale
  // value when that happens right after a brand-new mount. Editing an
  // already-loaded profile keeps the same id/key (no remount needed: the
  // form's own live state is already what the user is looking at).
  return <ProfileFormFields key={profile?.id ?? "new"} profile={profile} />;
}

function ProfileFormFields({
  profile,
}: {
  profile: (ProfileInput & { id: string }) | null | undefined;
}) {
  const mutation = useSaveProfileMutation();

  const form = useForm<ProfileInput>({
    resolver: zodResolver(profileSchema),
    defaultValues: profile ?? EMPTY_VALUES,
  });

  function onSubmit(values: ProfileInput) {
    mutation.mutate(values, {
      onSuccess: () => toast.success("Perfil salvo."),
      onError: (error: Error) => toast.error(error.message),
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 max-w-lg">
        <FormField
          control={form.control}
          name="jobTitles"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Cargos desejados (separados por vírgula)</FormLabel>
              <FormControl>
                <Input
                  value={field.value.join(", ")}
                  onChange={(e) =>
                    field.onChange(
                      e.target.value
                        .split(",")
                        .map((v) => v.trim())
                        .filter(Boolean)
                    )
                  }
                  placeholder="Desenvolvedor Backend Node, Frontend React"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="seniority"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Senioridade</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {SENIORITY_VALUES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="techStack"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Stack técnica (separada por vírgula)</FormLabel>
              <FormControl>
                <Input
                  value={field.value.join(", ")}
                  onChange={(e) =>
                    field.onChange(
                      e.target.value
                        .split(",")
                        .map((v) => v.trim())
                        .filter(Boolean)
                    )
                  }
                  placeholder="Node, React, PostgreSQL"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="location"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Localização</FormLabel>
              <FormControl>
                <Input {...field} placeholder="São Paulo, SP" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="workMode"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Modalidade</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {WORK_MODE_VALUES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="salaryMin"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Pretensão salarial mínima (R$/mês, opcional)</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  value={field.value ?? ""}
                  onChange={(e) =>
                    field.onChange(e.target.value ? Number(e.target.value) : undefined)
                  }
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="contractTypes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Tipos de contrato aceitos</FormLabel>
              <div className="flex flex-wrap gap-4">
                {CONTRACT_TYPE_VALUES.map((value) => (
                  <label key={value} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={field.value.includes(value)}
                      onCheckedChange={(checked) => {
                        field.onChange(
                          checked
                            ? [...field.value, value]
                            : field.value.filter((v) => v !== value)
                        );
                      }}
                    />
                    {value}
                  </label>
                ))}
              </div>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Salvando..." : "Salvar perfil"}
        </Button>
      </form>
    </Form>
  );
}
```

- [ ] **Step 4: Profile page**

Create `app/(app)/profile/page.tsx`:

```typescript
import { ProfileForm } from "@/components/profile/profile-form";
import { ResumeUpload } from "@/components/profile/resume-upload";

export default function ProfilePage() {
  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-xl font-semibold mb-4">Perfil</h1>
        <ProfileForm />
      </div>
      <div>
        <h2 className="text-lg font-semibold mb-4">Currículo</h2>
        <ResumeUpload />
      </div>
    </div>
  );
}
```

(`ResumeUpload` is created in Task 11 — this page won't compile until that task is done. That's expected; the two tasks are meant to be executed back to back.)

- [ ] **Step 5: Commit**

```bash
git add app/api/profile hooks/use-profile.ts components/profile/profile-form.tsx "app/(app)/profile"
git commit -m "feat: add profile API and form"
```

(This commit will include the not-yet-created `ResumeUpload` import in `page.tsx` — that's fine, Task 11 follows immediately and both land before anyone runs a full build. If you need this task to build in isolation, stub `ResumeUpload` as an empty component first and replace it in Task 11.)

---

## Task 11: Résumé upload and download

**Files:**
- Create: `app/api/resumes/route.ts`
- Create: `app/api/resumes/download/route.ts`
- Create: `hooks/use-resume.ts`
- Create: `components/profile/resume-upload.tsx`

- [ ] **Step 1: Upload route (POST)**

Create `app/api/resumes/route.ts`:

```typescript
import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiSession } from "@/lib/session";
import { errorResponse } from "@/lib/api-response";

const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const STORAGE_DIR = process.env.RESUME_STORAGE_DIR ?? "./data/resumes";

export async function GET() {
  const session = await requireApiSession();
  if (!session) return errorResponse("Não autenticado.", 401);

  try {
    const resume = await prisma.resume.findUnique({ where: { userId: session.user.id } });
    return NextResponse.json({ resume });
  } catch (error) {
    console.error("resume fetch failed", error);
    return errorResponse("Erro ao carregar currículo.", 500);
  }
}

export async function POST(request: Request) {
  const session = await requireApiSession();
  if (!session) return errorResponse("Não autenticado.", 401);

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) return errorResponse("Arquivo não enviado.", 400);
  if (file.type !== "application/pdf") return errorResponse("Envie um arquivo PDF.", 400);
  if (file.size > MAX_SIZE_BYTES) return errorResponse("Arquivo maior que 5MB.", 400);

  try {
    const userDir = path.join(STORAGE_DIR, session.user.id);
    await mkdir(userDir, { recursive: true });

    const existing = await prisma.resume.findUnique({ where: { userId: session.user.id } });

    // Write the new file and commit the DB row before touching the old
    // file, so a failure at either step leaves the previous resume intact
    // (worst case: one orphaned new file on disk, not a lost resume). The
    // new file always gets its own randomUUID() name, so this never
    // collides with the old one.
    const storedFileName = `${randomUUID()}.pdf`;
    const filePath = path.join(userDir, storedFileName);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, buffer);

    const resume = await prisma.resume.upsert({
      where: { userId: session.user.id },
      create: {
        userId: session.user.id,
        fileName: file.name,
        filePath,
        mimeType: file.type,
        size: file.size,
      },
      update: {
        fileName: file.name,
        filePath,
        mimeType: file.type,
        size: file.size,
        uploadedAt: new Date(),
      },
    });

    if (existing) {
      await unlink(existing.filePath).catch(() => {
        // Best-effort cleanup — a missing old file shouldn't block a new upload.
      });
    }

    return NextResponse.json({ resume });
  } catch (error) {
    console.error("resume upload failed", error);
    return errorResponse("Erro ao enviar currículo.", 500);
  }
}
```

- [ ] **Step 2: Download route (GET, streams the file)**

Create `app/api/resumes/download/route.ts`:

```typescript
import { readFile } from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import { requireApiSession } from "@/lib/session";
import { errorResponse } from "@/lib/api-response";

export async function GET() {
  const session = await requireApiSession();
  if (!session) return errorResponse("Não autenticado.", 401);

  try {
    const resume = await prisma.resume.findUnique({ where: { userId: session.user.id } });
    if (!resume) return errorResponse("Nenhum currículo encontrado.", 404);

    const buffer = await readFile(resume.filePath).catch(() => null);
    if (!buffer) return errorResponse("Arquivo não encontrado no armazenamento.", 404);

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": resume.mimeType,
        "Content-Disposition": `attachment; filename="${resume.fileName}"`,
      },
    });
  } catch (error) {
    console.error("resume download failed", error);
    return errorResponse("Erro ao baixar currículo.", 500);
  }
}
```

- [ ] **Step 3: Query hook**

Create `hooks/use-resume.ts`:

```typescript
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
```

- [ ] **Step 4: Upload component**

Create `components/profile/resume-upload.tsx`:

```typescript
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
```

- [ ] **Step 5: Verify manually**

Run: `yarn dev`, sign in, go to `/profile`, upload a small PDF.
Expected: toast "Currículo enviado.", the page shows the file name with a working "baixar" (download) link. Upload a second PDF.
Expected: the old file on disk (`data/resumes/<userId>/*.pdf`) is gone, replaced by the new one — `ls data/resumes/<userId>` shows exactly one file.

Stop the dev server after checking.

- [ ] **Step 6: Commit**

```bash
git add app/api/resumes hooks/use-resume.ts components/profile/resume-upload.tsx
git commit -m "feat: add résumé upload and download"
```

---

## Task 12: Playwright end-to-end test

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/onboarding.spec.ts`
- Create: `tests/e2e/fixtures/sample-resume.pdf`
- Modify: `package.json` (scripts)
- Modify: `vitest.config.ts`

- [ ] **Step 1: Playwright config**

Create `playwright.config.ts`:

```typescript
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  retries: 0,
  webServer: {
    command: "yarn dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
```

Add to `package.json` `scripts`: `"test:e2e": "playwright test"`.

Run: `npx playwright install chromium`
Expected: downloads the Chromium build Playwright drives.

**Scope Vitest away from this directory.** Vitest's default include glob also matches `**/*.spec.ts`, so once `tests/e2e/onboarding.spec.ts` exists, plain `yarn test` tries to import it too — and since it uses Playwright's own `test`/`expect`, not Vitest's, that fails immediately and turns `yarn test` into a false failure. Add `include` to `vitest.config.ts`'s `test` block:

```typescript
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    // Without this, Vitest's default include glob also picks up
    // tests/e2e/*.spec.ts, which imports Playwright's own test/expect and
    // fails immediately under Vitest's runner.
    include: ["tests/unit/**/*.test.ts"],
  },
```

Run: `yarn test`
Expected: `Test Files 2 passed (2)`, `Tests 13 passed (13)` — confirms Vitest no longer touches the Playwright spec.

- [ ] **Step 2: A minimal real PDF fixture**

Playwright needs an actual file to upload — a plain text file renamed `.pdf` would fail the route's `file.type !== "application/pdf"` check only if the browser doesn't report that MIME type, so use a real (if minimal) PDF. Create it with a script rather than hand-writing binary content:

Run:

```bash
mkdir -p tests/e2e/fixtures
node -e "
const fs = require('fs');
const pdf = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n';
fs.writeFileSync('tests/e2e/fixtures/sample-resume.pdf', pdf);
"
```

Expected: `tests/e2e/fixtures/sample-resume.pdf` exists and `file tests/e2e/fixtures/sample-resume.pdf` reports `PDF document`.

- [ ] **Step 3: Write the e2e test**

Create `tests/e2e/onboarding.spec.ts`:

```typescript
import { expect, test } from "@playwright/test";
import path from "node:path";

test("signup, create profile, and upload résumé", async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`;

  await page.goto("/signup");
  await page.getByLabel("Nome").fill("Ana E2E");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Senha").fill("abc12345");
  await page.getByRole("button", { name: "Criar conta" }).click();

  await expect(page).toHaveURL(/\/profile$/);

  await page.getByLabel(/Cargos desejados/).fill("Desenvolvedor Backend Node");
  await page.getByLabel(/Stack técnica/).fill("Node, PostgreSQL");
  await page.getByLabel("Localização").fill("São Paulo, SP");
  await page.getByLabel(/Pretensão salarial/).fill("8000");
  await page.getByRole("checkbox", { name: "CLT" }).check();
  await page.getByRole("button", { name: "Salvar perfil" }).click();
  await expect(page.getByText("Perfil salvo.")).toBeVisible();

  await page
    .locator('input[type="file"]')
    .setInputFiles(path.join(__dirname, "fixtures/sample-resume.pdf"));
  await expect(page.getByText("Currículo enviado.")).toBeVisible();
  await expect(page.getByText("sample-resume.pdf")).toBeVisible();

  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Senha").fill("abc12345");
  // exact: true — otherwise this also matches "Entrar com Google" (substring match by default)
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByText("sample-resume.pdf")).toBeVisible();
});
```

- [ ] **Step 4: Run it against a real (test) database**

This test creates real rows and a real file on disk — run it against the dev Postgres (Task 1), same as manual testing does.

Run: `yarn test:e2e`
Expected: `1 passed`. If the run leaves `data/resumes/<uuid>/sample-resume.pdf` behind, that's expected — it's the same local storage manual testing already uses, and it's gitignored.

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts tests/e2e package.json vitest.config.ts
git commit -m "test: add signup-to-résumé-upload e2e test"
```

---

## Task 13: Root page, Dockerfile, README, final smoke test

**Files:**
- Modify: `app/page.tsx`
- Create: `Dockerfile`
- Create: `.dockerignore`
- Modify: `README.md`
- Modify: `next.config.ts`
- Modify: `app/api/resumes/route.ts`

- [ ] **Step 1: Root page**

Replace the create-next-app placeholder. Edit `app/page.tsx`:

```typescript
import Link from "next/link";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";

export default async function Home() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-2xl font-semibold">Easy Job App</h1>
      <p className="max-w-md text-muted-foreground">
        Encontre e aplique para vagas de tecnologia de forma autônoma.
      </p>
      <div className="flex gap-3">
        <Button asChild>
          <Link href="/signup">Criar conta</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/login">Entrar</Link>
        </Button>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Dockerfile (Coolify deploy target)**

Create `.dockerignore`:

```
node_modules
.next
data
generated
tests
.git
*.md
.env
.env.*
```

`.env`/`.env.*` matter here beyond the usual "don't leak secrets into a build context" hygiene: Next's `output: "standalone"` copies whatever `.env*` files are present at build time straight into `.next/standalone`, which the Dockerfile's runner stage then copies verbatim into the final image layer. Without this exclusion, running `docker build` from a working tree with a local `.env` (the normal dev setup) bakes real secrets into the shipped image.

Also add to `next.config.ts` (the résumé routes' `path.join(RESUME_STORAGE_DIR, ...)` uses an env var, which isn't statically analyzable — without this, the production file tracer falls back to bundling the entire project, including test/doc files that don't belong in a deploy artifact):

```typescript
  outputFileTracingExcludes: {
    "/*": [
      "./tests/**/*",
      "./docs/**/*",
      "./.env",
      "./.env.*",
      "./data/**/*",
      "./prisma/migrations/**/*",
    ],
  },
```

And in `app/api/resumes/route.ts`, mark the dynamic path as intentional so the bundler stops flagging it (this doesn't affect the `.dockerignore` fix above, which is what actually keeps `.env` out of the shipped image — this just quiets the build warning and trims incidental bloat from local standalone output):

```typescript
    const userDir = path.join(/* turbopackIgnore: true */ STORAGE_DIR, session.user.id);
```

Create `Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# prisma.config.ts requires DATABASE_URL to resolve at build time (for
# `prisma generate`, which only reads the schema — it never connects).
# The real value is supplied at container runtime by Coolify.
ARG DATABASE_URL="postgresql://user:pass@localhost:5432/db?schema=public"
ENV DATABASE_URL=${DATABASE_URL}
RUN ./node_modules/.bin/prisma generate
RUN yarn build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

RUN mkdir -p /app/data/resumes && chown -R nextjs:nodejs /app/data

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV RESUME_STORAGE_DIR=/app/data/resumes

CMD ["node", "server.js"]
```

**For Coolify:** mount a persistent volume at `/app/data` (résumés live there) and set `DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` as real environment variables on the service — the Postgres database itself can be a Coolify-managed Postgres service or any reachable instance.

- [ ] **Step 3: Update README**

Replace the create-next-app boilerplate in `README.md` with:

```markdown
# Easy Job App

Plataforma que busca e aplica para vagas de tecnologia de forma autônoma
(LinkedIn, Indeed, InfoJobs). Este repositório contém, por enquanto, a
Fundação: autenticação, perfil de busca e upload de currículo. Os demais
sub-projetos (ingestão de vagas, matching por IA, auto-apply, dashboard)
têm suas próprias specs em `docs/superpowers/specs/`.

## Rodando localmente

1. `docker compose up -d` — sobe o Postgres local.
2. Copie `.env.example` para `.env` e gere `AUTH_SECRET` com `openssl rand -base64 32`.
3. `yarn install`
4. `./node_modules/.bin/prisma migrate dev` seguido de `./node_modules/.bin/prisma generate`
5. `yarn dev` — app em `http://localhost:3000`

## Testes

- `yarn test` — testes unitários (Vitest): schemas Zod, helpers.
- `yarn test:e2e` — teste e2e (Playwright): cadastro → perfil → upload de currículo.

## Deploy

Self-hosted via Coolify a partir do `Dockerfile` — veja a nota no próprio
arquivo sobre variáveis de ambiente e o volume persistente para currículos.
```

- [ ] **Step 4: Full smoke test — build, docker build, migrate deploy**

Run: `yarn build`
Expected: succeeds, no type errors.

Run: `yarn lint`
Expected: no errors (warnings are fine to leave for now, but nothing that fails the build).

Run: `docker build -t easy-job-app:foundation .`
Expected: all three stages complete; final image builds successfully.

Run:

```bash
docker run --rm --network host \
  -e DATABASE_URL="postgresql://postgres:postgres@localhost:5432/easy_job_app?schema=public" \
  -e AUTH_SECRET="$(openssl rand -base64 32)" \
  -e AUTH_URL="http://localhost:3001" \
  -p 3001:3000 easy-job-app:foundation
```

(with `docker compose up -d` from Task 1 still running so Postgres is reachable at `localhost:5432`)

Run: `curl -s http://localhost:3001` in another terminal.
Expected: HTML response, no 500 error. Stop the container after checking (Ctrl+C).

- [ ] **Step 5: Run the full test suite one last time**

Run: `yarn test && yarn test:e2e`
Expected: both suites pass.

- [ ] **Step 6: Commit**

```bash
git add app/page.tsx Dockerfile .dockerignore README.md next.config.ts app/api/resumes/route.ts
git commit -m "feat: add landing page, Dockerfile, and README for Foundation"
```

---

## Plan Self-Review

**Spec coverage** — every section of `docs/superpowers/specs/2026-07-30-job-platform-foundation-design.md` maps to a task:
- Arquitetura (Next.js full-stack, API-first) → Tasks 1, 2, 5–11.
- Modelo de dados → Task 2.
- Auth → Tasks 5, 6, 8, 9 (with the JWT-strategy correction called out at the top of this plan).
- Fluxo de dados (perfil + CV, named volume) → Tasks 10, 11, 13.
- Erros (`{error:{field,message}}`, mensagem genérica de auth) → Task 6 (`api-response.ts`), Task 5 (`authorize` returns `null` uniformly).
- Testes (Vitest schemas/utils, Playwright e2e crítico) → Tasks 3, 4, 12.

**Deviations from the approved spec** (all load-bearing technical corrections, not preference changes — flagged to the user, not silently applied):
1. Session strategy is **JWT, not database** — Auth.js hard-requires this whenever a Credentials provider is configured.
2. Redis is **not** part of this sub-project's `docker-compose.yml` — nothing here uses a queue; it arrives in Sub-project B.
3. Prisma Client generation and instantiation follow **Prisma 7's** driver-adapter model (`@prisma/adapter-pg`), which didn't exist in the spec's original phrasing ("Prisma pra gerenciar os bancos") — this is an implementation detail, not a behavior change.

**Type consistency** — `ProfileInput`/`SignupInput`/`LoginInput` (from `lib/schemas/*`) are the single source of truth used in: route handlers (Tasks 6, 10), forms (Tasks 8, 10), and query hooks (Tasks 10, 11) — no parallel/duplicated type definitions. `requireApiSession()`/`requireSession()` (Task 9) are the only two session-check entry points, used consistently by every protected route handler and layout added afterward.

**No placeholders** — every step above has literal, complete file contents.
