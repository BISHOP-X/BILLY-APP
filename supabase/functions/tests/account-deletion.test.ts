import {
  assertEquals,
  assertMatch,
} from "jsr:@std/assert@1";

import { createAccountDeletionHandler } from "../_shared/account-deletion/handler.ts";

function dependencies(options: { authenticated?: boolean; deleteFails?: boolean } = {}) {
  const calls: string[] = [];
  return {
    calls,
    value: {
      async authenticate() {
        calls.push("authenticate");
        return options.authenticated === false ? null : { id: "user-1" };
      },
      async createOrResumeRequest() {
        calls.push("create");
        return "request-1";
      },
      async markCompleted() {
        calls.push("completed");
      },
      async markFailed() {
        calls.push("failed");
      },
      async softDeleteUser() {
        calls.push("delete");
        if (options.deleteFails) throw new Error("provider unavailable");
      },
    },
  };
}

Deno.test("account deletion requires a bearer session", async () => {
  const runtime = dependencies();
  const response = await createAccountDeletionHandler(runtime.value)(
    new Request("https://example.test", { method: "POST" }),
  );
  assertEquals(response.status, 401);
  assertEquals(runtime.calls, []);
});

Deno.test("account deletion requires explicit confirmation", async () => {
  const runtime = dependencies();
  const response = await createAccountDeletionHandler(runtime.value)(
    new Request("https://example.test", {
      body: JSON.stringify({ confirmation: "delete" }),
      headers: { authorization: "Bearer token", "content-type": "application/json" },
      method: "POST",
    }),
  );
  assertEquals(response.status, 400);
  assertEquals(runtime.calls, ["authenticate"]);
});

Deno.test("account deletion records, soft deletes, then completes", async () => {
  const runtime = dependencies();
  const response = await createAccountDeletionHandler(runtime.value)(
    new Request("https://example.test", {
      body: JSON.stringify({ confirmation: "DELETE" }),
      headers: { authorization: "Bearer token", "content-type": "application/json" },
      method: "POST",
    }),
  );
  assertEquals(response.status, 200);
  assertEquals(runtime.calls, ["authenticate", "create", "delete", "completed"]);
  assertMatch(await response.text(), /"status":"completed"/);
});

Deno.test("account deletion preserves a failed audit state", async () => {
  const runtime = dependencies({ deleteFails: true });
  const response = await createAccountDeletionHandler(runtime.value)(
    new Request("https://example.test", {
      body: JSON.stringify({ confirmation: "DELETE" }),
      headers: { authorization: "Bearer token", "content-type": "application/json" },
      method: "POST",
    }),
  );
  assertEquals(response.status, 503);
  assertEquals(runtime.calls, ["authenticate", "create", "delete", "failed"]);
});
