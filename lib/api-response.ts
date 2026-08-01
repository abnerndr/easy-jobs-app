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
