export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-80"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 20% 10%, oklch(0.9 0.06 55 / 0.55), transparent), radial-gradient(ellipse 70% 50% at 90% 90%, oklch(0.9 0.03 95 / 0.7), transparent)",
        }}
      />
      <div className="relative w-full max-w-sm">{children}</div>
    </div>
  );
}
