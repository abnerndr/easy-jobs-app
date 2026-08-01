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
