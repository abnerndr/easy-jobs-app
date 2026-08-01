"use client";

import { Button } from "@/components/ui/button";
import { LogoutButton } from "@/components/app-shell/logout-button";
import { useUIStore } from "@/stores/ui-store";

export function Topbar({ userName }: { userName: string | null | undefined }) {
  const toggleMobileNav = useUIStore((state) => state.toggleMobileNav);

  return (
    <header className="bg-card/80 supports-backdrop-filter:bg-card/70 sticky top-0 z-30 flex items-center justify-between border-b px-4 py-3 backdrop-blur md:px-8">
      <Button
        variant="outline"
        size="sm"
        className="md:hidden"
        onClick={toggleMobileNav}
      >
        Menu
      </Button>
      <div className="hidden md:block" />
      <div className="flex items-center gap-3">
        <span className="text-muted-foreground text-sm">{userName ?? "Minha conta"}</span>
        <LogoutButton />
      </div>
    </header>
  );
}
