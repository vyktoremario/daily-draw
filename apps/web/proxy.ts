// Country blocking in front of every page and API route (Next.js 16 "proxy", formerly
// middleware). The list and the decision live in lib/geo.ts.
import { NextResponse, type NextRequest } from 'next/server';
import { blockedCountriesFromEnv, isBlocked } from './lib/geo';

const UNAVAILABLE_PATH = '/unavailable';

export function proxy(request: NextRequest) {
  const blocked = isBlocked(
    request.headers.get('x-vercel-ip-country'),
    request.headers.get('x-vercel-ip-country-region'),
    blockedCountriesFromEnv(process.env),
  );
  if (!blocked) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Not available in your country.' }, { status: 451 });
  }
  // Same address, the "not available" page instead, with 451 (Unavailable For Legal Reasons).
  return NextResponse.rewrite(new URL(UNAVAILABLE_PATH, request.url), { status: 451 });
}

export const config = {
  // Everything except Next's own static files, other files with an extension (icons, images)
  // and the "not available" page itself.
  matcher: ['/((?!_next/static|_next/image|unavailable|.*\\.[a-zA-Z0-9]+$).*)'],
};
