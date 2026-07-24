import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// CardOps standalone confinement: this app serves ONLY owner + card_ops.
// A member (or a signed-in stranger with no role) is bounced to /login with
// the not-allowed banner — their invite/member world lives in MasterOps, not
// here. RLS is the real data boundary regardless; this shapes the UX.
export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // getUser() may have rotated the session cookies onto supabaseResponse —
  // carry them onto any redirect/JSON response or the fresh tokens are lost.
  const withSessionCookies = (res: NextResponse) => {
    supabaseResponse.cookies.getAll().forEach((c) => res.cookies.set(c));
    return res;
  };

  const { pathname } = request.nextUrl;
  // Public shareable showcases need no login (buyers browse your table).
  if (pathname.startsWith("/showcase")) return supabaseResponse;
  const isPublic = pathname.startsWith("/login") || pathname.startsWith("/auth");

  if (!user) {
    // API routes self-auth with JSON 401s; pages go to login.
    if (!isPublic && !pathname.startsWith("/api")) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = "";
      return withSessionCookies(NextResponse.redirect(url));
    }
    return supabaseResponse;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  const role = profile?.role ?? null;
  const allowed = role === "owner" || role === "card_ops";

  if (!allowed) {
    if (pathname.startsWith("/api")) {
      return withSessionCookies(NextResponse.json({ error: "forbidden" }, { status: 403 }));
    }
    if (!isPublic) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = "?error=not-allowed";
      return withSessionCookies(NextResponse.redirect(url));
    }
    return supabaseResponse;
  }

  // Card-capable user on the login screen → straight to the inventory.
  if (pathname.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/cards";
    url.search = "";
    return withSessionCookies(NextResponse.redirect(url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    // Explicit allowlist of this app's real static assets — an extension
    // wildcard would let dynamic routes ending in .png etc. dodge the proxy.
    "/((?!_next/static|_next/image|favicon\\.ico|manifest\\.webmanifest|apple-touch-icon\\.png|icon-192\\.png|icon-512\\.png).*)",
  ],
};
