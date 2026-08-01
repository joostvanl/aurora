import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { token?: unknown }
    | null;

  if (!body || typeof body.token !== "string" || !body.token) {
    return NextResponse.json({ message: "token required" }, { status: 400 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set("aurora_cms_token", body.token, {
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
}
