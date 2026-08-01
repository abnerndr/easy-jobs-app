import { redirect } from "next/navigation";
import { auth } from "@/auth";

/**
 * For Server Components/layouts only — never Route Handlers. `redirect()`
 * also works inside Route Handlers, so a misuse there wouldn't crash: it
 * would silently return a 307 to /login instead of a 401 JSON body, which
 * `fetch()` follows by default, leaving a JSON caller to fail obscurely
 * (parsing the login page's HTML as JSON) instead of seeing a clean 401.
 * Use requireApiSession() in Route Handlers instead.
 */
export async function requireSession() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  return session;
}

/** For Route Handlers: returns null instead of redirecting (callers return 401 JSON). */
export async function requireApiSession() {
  const session = await auth();
  if (!session?.user) {
    return null;
  }
  return session;
}
