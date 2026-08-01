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
