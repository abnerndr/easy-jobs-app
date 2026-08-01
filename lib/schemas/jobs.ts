import * as z from "zod";

export const APPLICATION_STATUS_VALUES = [
  "FOUND",
  "QUEUED",
  "APPLIED",
  "EXTERNAL_REDIRECT",
  "FAILED",
  "SKIPPED",
] as const;

export const jobSettingsSchema = z.object({
  dailyApplyLimit: z
    .number()
    .int()
    .min(1, { error: "O limite mínimo é 1." })
    .max(100, { error: "O limite máximo é 100." }),
  autoQueue: z.boolean().optional(),
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

export type JobSettingsInput = z.infer<typeof jobSettingsSchema>;
