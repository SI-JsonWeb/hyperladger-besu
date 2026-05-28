import { NextRequest, NextResponse } from 'next/server';

const backendUrl = process.env.BACKEND_URL || 'http://127.0.0.1:8080';

async function proxy(request: NextRequest, path: string[]) {
  const target = new URL(path.join('/'), backendUrl.endsWith('/') ? backendUrl : `${backendUrl}/`);
  request.nextUrl.searchParams.forEach((value, key) => target.searchParams.set(key, value));

  const headers = new Headers();
  const contentType = request.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);
  if (process.env.BACKEND_API_KEY) headers.set('x-api-key', process.env.BACKEND_API_KEY);

  const response = await fetch(target, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text(),
    cache: 'no-store',
  });

  const text = await response.text();
  return new NextResponse(text, {
    status: response.status,
    headers: { 'content-type': response.headers.get('content-type') || 'application/json' },
  });
}

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxy(request, (await context.params).path);
}

export async function POST(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxy(request, (await context.params).path);
}
