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
    // instead. Same response either way, so it's not distinguishable
    // from the check-then-act 409 case.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return errorResponse(DUPLICATE_EMAIL_MESSAGE, 409);
    }

    console.error("signup failed", error);
    return errorResponse("Erro ao criar conta.", 500);
  }
}
