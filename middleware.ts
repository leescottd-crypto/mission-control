import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

const PUBLIC_PATH_PREFIXES = ["/api/auth", "/api/health", "/signin", "/_next", "/favicon.ico"];

export async function middleware(request: NextRequest) {
    if (process.env.AUTH_ENABLED !== "true") {
        return NextResponse.next();
    }

    const { pathname, search } = request.nextUrl;
    const isPublicPath = PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
    if (isPublicPath) {
        return NextResponse.next();
    }

    const token = await getToken({
        req: request,
        secret: process.env.NEXTAUTH_SECRET,
    });

    if (token) {
        return NextResponse.next();
    }

    const signInUrl = new URL("/signin", request.url);
    signInUrl.searchParams.set("callbackUrl", `${pathname}${search}`);
    return NextResponse.redirect(signInUrl);
}

export const config = {
    matcher: ["/((?!api/health|_next/static|_next/image).*)"],
};
