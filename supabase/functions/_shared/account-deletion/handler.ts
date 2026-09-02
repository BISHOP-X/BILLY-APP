export type AccountDeletionDependencies = {
  authenticate: (token: string) => Promise<{ id: string } | null>;
  createOrResumeRequest: (userId: string) => Promise<string>;
  markCompleted: (requestId: string) => Promise<void>;
  markFailed: (requestId: string) => Promise<void>;
  softDeleteUser: (userId: string) => Promise<void>;
};

const ALLOWED_WEB_ORIGINS = new Set([
  "https://app.billyapp.org",
  "http://localhost:8081",
  "http://127.0.0.1:8081",
]);

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin");
  return {
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Origin": origin && ALLOWED_WEB_ORIGINS.has(origin)
      ? origin
      : "https://app.billyapp.org",
    "Vary": "Origin",
  };
}

function json(request: Request, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    headers: {
      ...corsHeaders(request),
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
    status,
  });
}

export function createAccountDeletionHandler(dependencies: AccountDeletionDependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(request), status: 204 });
    }
    if (request.method !== "POST") {
      return json(request, 405, { error: "method_not_allowed" });
    }

    const authorization = request.headers.get("authorization") ?? "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match?.[1]) {
      return json(request, 401, { error: "authentication_required" });
    }

    const user = await dependencies.authenticate(match[1]);
    if (!user) {
      return json(request, 401, { error: "invalid_session" });
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return json(request, 400, { error: "invalid_request" });
    }

    if (
      typeof payload !== "object" ||
      payload === null ||
      Array.isArray(payload) ||
      (payload as Record<string, unknown>).confirmation !== "DELETE"
    ) {
      return json(request, 400, { error: "confirmation_required" });
    }

    let requestId: string;
    try {
      requestId = await dependencies.createOrResumeRequest(user.id);
    } catch {
      return json(request, 503, { error: "request_unavailable" });
    }

    try {
      await dependencies.softDeleteUser(user.id);
    } catch {
      await dependencies.markFailed(requestId).catch(() => undefined);
      return json(request, 503, {
        error: "deletion_unavailable",
        requestId,
      });
    }

    await dependencies.markCompleted(requestId).catch(() => undefined);
    return json(request, 200, { requestId, status: "completed" });
  };
}
