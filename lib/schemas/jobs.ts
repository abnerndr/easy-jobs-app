import * as z from "zod";

export const APPLICATION_STATUS_VALUES = [
  "FOUND",
  "QUEUED",
  "MATCHED",
  "APPLIED",
  "EXTERNAL_REDIRECT",
  "FAILED",
  "SKIPPED",
] as const;

export const jobSettingsSchema = z.object({
  searchTarget: z
    .number()
    .int()
    .min(1, { error: "O mínimo por busca é 1." })
    .max(100, { error: "O máximo por busca é 100." }),
  autoQueue: z.boolean().optional(),
  minMatchScore: z.number().int().min(0).max(100).optional(),
});

export const applicationsQuerySchema = z.object({
  status: z.enum(APPLICATION_STATUS_VALUES).optional(),
});

export const applySelectedSchema = z.object({
  applicationIds: z
    .array(z.string().min(1))
    .min(1, { error: "Selecione ao menos uma vaga." })
    .max(50, { error: "Selecione no máximo 50 vagas por vez." }),
});

export const matchSelectedSchema = z.object({
  applicationIds: z
    .array(z.string().min(1))
    .min(1, { error: "Selecione ao menos uma vaga." })
    .max(50, { error: "Selecione no máximo 50 vagas por vez." }),
});

export type JobSettingsInput = z.infer<typeof jobSettingsSchema>;
