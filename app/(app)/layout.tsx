import { requireSession } from "@/lib/session";
import { Sidebar } from "@/components/app-shell/sidebar";
import { Topbar } from "@/components/app-shell/topbar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();

  return (
    <div className="bg-background flex min-h-screen">
      <Sidebar />
      <div className="bg-muted/35 flex min-w-0 flex-1 flex-col">
        <Topbar userName={session.user?.name} />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-8 md:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
