import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PROTECTED_PAGE_PREFIXES = [
  "/admin",
  "/calendar",
  "/calls",
  "/contacts",
  "/data-health",
  "/follow-ups",
  "/import",
  "/inbound-calls",
  "/investisseurs",
  "/leads",
  "/letters",
  "/map",
  "/phone-review",
  "/pipeline",
  "/properties",
  "/quick-call",
  "/review",
  "/textos",
];

const PUBLIC_API_PREFIXES = [
  "/api/auth",
  "/api/cron/process-queue",
  "/api/enrichment/openclaw-callback",
  "/api/enrichment/run",
  "/api/follow-ups/sync-batch",
  "/api/n8n",
  "/api/phone-enrichment",
  "/api/twilio/voice",
];

const PUBLIC_API_ROUTES = new Set([
  "/api/enrichment/bulk-start",
  "/api/follow-ups/[id]/sync",
  "/api/health",
  "/api/import/codex-launch",
  "/api/telegram/webhook",
  "/api/twilio/messages/inbound",
]);

function isPublicApiRoute(pathname: string) {
  if (PUBLIC_API_ROUTES.has(pathname)) return true;
  if (/^\/api\/follow-ups\/[^/]+\/sync$/.test(pathname)) return true;
  return PUBLIC_API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isSafeRelativePath(value: string | null): value is string {
  return Boolean(value?.startsWith("/") && !value.startsWith("//"));
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) => {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Refresh the session if it has expired.
  const { data: { user } } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isPublicRoute = pathname === "/" || pathname === "/login" || pathname.startsWith("/auth");
  const isApiRoute = pathname.startsWith("/api/");
  const isProtectedPage = PROTECTED_PAGE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  const isProtectedApi = isApiRoute && !isPublicApiRoute(pathname);
  const isProtected = isProtectedPage || isProtectedApi;

  if (isProtected && !user) {
    if (isProtectedApi) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const next = request.nextUrl.searchParams.get("next");
    const destination = isSafeRelativePath(next) ? new URL(next, request.url) : new URL("/leads", request.url);
    const url = request.nextUrl.clone();
    url.pathname = destination.pathname;
    url.search = destination.search;
    return NextResponse.redirect(url);
  }

  if (!isProtected && !isPublicRoute && !isApiRoute) {
    return response;
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
