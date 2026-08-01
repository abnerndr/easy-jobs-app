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
  // with EMPTY_VALUES's value and only get corrected via reset() a tick
  // later — Radix Select's trigger display gets stuck showing the stale
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
