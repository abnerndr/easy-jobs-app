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
