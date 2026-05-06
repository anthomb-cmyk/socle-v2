import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

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

  // Routes that require auth
  const protectedPrefixes = ["/leads", "/import", "/review", "/calls", "/admin", "/api"];
  const isProtected = protectedPrefixes.some((p) => request.nextUrl.pathname.startsWith(p));
  const isAuthRoute = request.nextUrl.pathname.startsWith("/auth")
    || request.nextUrl.pathname === "/login"
    || request.nextUrl.pathname === "/api/health"
    || request.nextUrl.pathname.startsWith("/api/n8n")          // machine-to-machine; uses Bearer token auth
    || request.nextUrl.pathname === "/api/enrichment/openclaw-callback" // n8n callback; uses N8N_SHARED_KEY Bearer auth
    || request.nextUrl.pathname === "/api/enrichment/run"        // n8n runner; uses N8N_SHARED_KEY Bearer auth
    || request.nextUrl.pathname === "/api/cron/process-queue"    // Railway cron; uses CRON_SECRET Bearer auth
    || request.nextUrl.pathname.startsWith("/api/twilio/voice/"); // Twilio webhooks — called by Twilio servers, no session cookie

  if (isProtected && !user && !isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
