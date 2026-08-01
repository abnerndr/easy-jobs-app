"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BriefcaseIcon,
  LayoutDashboardIcon,
  UserRoundIcon,
} from "lucide-react";
import { useUIStore } from "@/stores/ui-store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Painel", icon: LayoutDashboardIcon },
  { href: "/applications", label: "Status", icon: BriefcaseIcon },
  { href: "/profile", label: "Perfil", icon: UserRoundIcon },
];

export function Sidebar() {
  const pathname = usePathname();
  const isOpen = useUIStore((state) => state.isMobileNavOpen);
  const setOpen = useUIStore((state) => state.setMobileNavOpen);

  return (
    <nav
      className={cn(
        "bg-sidebar text-sidebar-foreground w-60 shrink-0 border-r p-4",
        "md:block",
        isOpen ? "fixed inset-y-0 left-0 z-40 block shadow-lg md:static md:shadow-none" : "hidden"
      )}
    >
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-2.5 px-2">
          <span className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg text-sm font-bold tracking-tight">
            EJ
          </span>
          <div className="flex flex-col">
            <p className="font-heading text-sm font-semibold tracking-tight">
              Easy Job
            </p>
            <p className="text-muted-foreground text-xs">Vagas com foco</p>
          </div>
        </div>
        <Separator />
        <div className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Button
                key={item.href}
                variant={active ? "secondary" : "ghost"}
                className={cn(
                  "justify-start",
                  active && "bg-sidebar-accent text-sidebar-accent-foreground"
                )}
                asChild
              >
                <Link href={item.href} onClick={() => setOpen(false)}>
                  <Icon data-icon="inline-start" />
                  {item.label}
                </Link>
              </Button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
