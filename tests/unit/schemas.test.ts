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
    const withoutSalary = { ...validProfile };
    delete withoutSalary.salaryMin;
    expect(profileSchema.safeParse(withoutSalary).success).toBe(true);
  });
});
