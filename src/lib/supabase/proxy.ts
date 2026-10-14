import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PREFIXES = ["/login", "/forgot-password", "/reset-password", "/auth", "/invite", "/design", "/api/health"];

/**
 * Refreshes the Supabase session cookie and tags the request with an id.
 * The redirect below is UX only: authorization happens in requireMembership() on every page,
 * Server Action and route handler (proxy is not a security boundary).
 */
export async function updateSession(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", request.headers.get("x-request-id") ?? crypto.randomUUID());

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request: { headers: requestHeaders } });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Nothing between createServerClient and getClaims(), or sessions get dropped at random.
  const { data } = await supabase.auth.getClaims();

  const { pathname } = request.nextUrl;
  const isPublic = pathname === "/" || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
  if (!data?.claims && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }
  return response;
}
