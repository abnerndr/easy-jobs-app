import { config as loadDotenv } from "dotenv";

// Next may have started before .env was saved; reload from disk at runtime.
loadDotenv({ override: false });

export type ApplicantContext = {
  name: string | null;
  email: string;
  jobTitles: string[];
  seniority: string;
  techStack: string[];
  location: string;
  workMode: string;
  salaryMin: number | null;
  contractTypes: string[];
  yearsExperienceHint?: string;
};

export type FormAnswerRequest = {
  question: string;
  fieldType: "text" | "textarea" | "select" | "radio" | "checkbox" | "unknown";
  options?: string[];
  jobTitle?: string;
  company?: string;
};

function buildSystemPrompt(profile: ApplicantContext) {
  return `Você preenche formulários de candidatura (LinkedIn Easy Apply).
Responda de forma curta, profissional e honesta com base neste perfil do candidato.
Não invente certificações, empresas ou datas que não estejam no perfil.
Se for pergunta de sim/não e o perfil não deixar claro, prefira a opção mais favorável e realista.
Se for select/radio, devolva EXATAMENTE uma das opções fornecidas.
Se for checkbox múltiplo, devolva opções separadas por " | ".
Responda só com o valor do campo, sem aspas nem explicação.

Perfil:
- Nome: ${profile.name ?? "não informado"}
- Email: ${profile.email}
- Cargos: ${profile.jobTitles.join(", ")}
- Senioridade: ${profile.seniority}
- Stack: ${profile.techStack.join(", ")}
- Localização: ${profile.location}
- Modalidade: ${profile.workMode}
- Pretensão salarial (mín): ${profile.salaryMin ?? "não informada"}
- Contratos: ${profile.contractTypes.join(", ")}
${profile.yearsExperienceHint ? `- Experiência: ${profile.yearsExperienceHint}` : ""}`;
}

function buildUserPrompt(req: FormAnswerRequest) {
  const parts = [
    `Pergunta/label do campo: ${req.question}`,
    `Tipo: ${req.fieldType}`,
  ];
  if (req.jobTitle) parts.push(`Vaga: ${req.jobTitle}`);
  if (req.company) parts.push(`Empresa: ${req.company}`);
  if (req.options?.length) parts.push(`Opções: ${req.options.join(" || ")}`);
  return parts.join("\n");
}

async function answerWithOpenAI(
  profile: ApplicantContext,
  req: FormAnswerRequest
): Promise<string> {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const completion = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      { role: "system", content: buildSystemPrompt(profile) },
      { role: "user", content: buildUserPrompt(req) },
    ],
  });
  return completion.choices[0]?.message?.content?.trim() || "";
}

async function answerWithGemini(
  profile: ApplicantContext,
  req: FormAnswerRequest
): Promise<string> {
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const key =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.GOOGLE_API_KEY;
  if (!key) throw new Error("Gemini API key missing");
  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL || "gemini-2.0-flash",
  });
  const result = await model.generateContent(
    `${buildSystemPrompt(profile)}\n\n${buildUserPrompt(req)}`
  );
  return result.response.text().trim();
}

export function getConfiguredAiProvider(): "openai" | "gemini" | null {
  // Pick up keys saved to .env after the process started.
  loadDotenv({ override: false });

  if (process.env.OPENAI_API_KEY?.trim()) return "openai";
  if (
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ||
    process.env.GOOGLE_API_KEY?.trim()
  ) {
    return "gemini";
  }
  return null;
}

/**
 * Answers a form field using OpenAI if available, otherwise Gemini.
 */
export async function answerFormQuestion(
  profile: ApplicantContext,
  req: FormAnswerRequest
): Promise<string> {
  const heuristic = heuristicAnswer(profile, req);
  if (heuristic) return heuristic;

  const provider = getConfiguredAiProvider();
  if (!provider) {
    throw new Error(
      "Configure OPENAI_API_KEY ou GEMINI_API_KEY no .env para preencher formulários."
    );
  }

  try {
    if (provider === "openai") return await answerWithOpenAI(profile, req);
    return await answerWithGemini(profile, req);
  } catch (primaryError) {
    // Fallback to the other provider if both keys exist
    const other = provider === "openai" ? "gemini" : "openai";
    const hasOther =
      other === "openai"
        ? Boolean(process.env.OPENAI_API_KEY?.trim())
        : Boolean(
            process.env.GEMINI_API_KEY?.trim() ||
              process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ||
              process.env.GOOGLE_API_KEY?.trim()
          );
    if (!hasOther) throw primaryError;
    if (other === "openai") return await answerWithOpenAI(profile, req);
    return await answerWithGemini(profile, req);
  }
}

function heuristicAnswer(
  profile: ApplicantContext,
  req: FormAnswerRequest
): string | null {
  const q = req.question.toLowerCase();
  if (/e-?mail|correo|mail/.test(q)) return profile.email;
  if (/^(nome|name|full name|nome completo)/.test(q) || /full name|nome completo/.test(q)) {
    return profile.name || profile.email.split("@")[0];
  }
  if (/phone|telefone|celular|mobile|whatsapp/.test(q)) return null;
  if (/cidade|city|location|localiza|onde mora|based/.test(q)) return profile.location;
  if (/salary|sal[aá]rio|compensa|pretens/.test(q) && profile.salaryMin) {
    return String(profile.salaryMin);
  }
  if (req.options?.length) {
    const lowerOpts = req.options.map((o) => o.toLowerCase());
    if (/remot|híbrid|hibrid|presencial|onsite|on-site/.test(q)) {
      const prefer =
        profile.workMode === "REMOTO"
          ? ["remote", "remoto", "fully remote"]
          : profile.workMode === "HIBRIDO"
            ? ["hybrid", "híbrido", "hibrido"]
            : ["on-site", "onsite", "presencial", "office"];
      for (const p of prefer) {
        const idx = lowerOpts.findIndex((o) => o.includes(p));
        if (idx >= 0) return req.options[idx];
      }
    }
  }
  return null;
}
