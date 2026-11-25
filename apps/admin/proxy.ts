// Basic auth in front of every page (Next.js 16 "proxy", formerly middleware).
import { NextResponse, type NextRequest } from 'next/server';
import { authorize, credentialsFromEnv } from './lib/auth';

export function proxy(request: NextRequest) {
  const decision = authorize(
    request.headers.get('authorization'),
    credentialsFromEnv(process.env),
    process.env.NODE_ENV === 'development',
  );
  if (decision === 'allow') return NextResponse.next();
  if (decision === 'unconfigured') {
    return new NextResponse('Set ADMIN_USER and ADMIN_PASSWORD to open the dashboard.', {
      status: 503,
    });
  }
  return new NextResponse('Authentication required.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Daily Draw admin", charset="UTF-8"' },
  });
}

export const config = {
  // Everything except Next's own static files.
  matcher: ['/((?!_next/static|_next/image).*)'],
};
