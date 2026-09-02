import { createClient } from "@supabase/supabase-js";
import { createAccountDeletionHandler } from "../_shared/account-deletion/handler.ts";

const BILLY_PROJECT_REF = "omsrzwwudskxpkyynnxw";

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function assertBillyProjectUrl(value: string): string {
  const parsed = new URL(value);
  const isLocal = parsed.protocol === "http:" &&
    ["127.0.0.1", "localhost"].includes(parsed.hostname);
  const isBillyHosted = parsed.protocol === "https:" &&
    parsed.hostname === `${BILLY_PROJECT_REF}.supabase.co`;
  if ((!isLocal && !isBillyHosted) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("SUPABASE_URL is not the Billy project.");
  }
  return parsed.toString().replace(/\/+$/, "");
}

const supabaseUrl = assertBillyProjectUrl(requiredEnv("SUPABASE_URL"));
const publishableKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY")?.trim() ||
  requiredEnv("SUPABASE_ANON_KEY");
const secretKey = Deno.env.get("SUPABASE_SECRET_KEY")?.trim() ||
  requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

if (publishableKey === secretKey) {
  throw new Error("Billy public and server Supabase keys must be distinct.");
}

const authClient = createClient(supabaseUrl, publishableKey, {
  auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
});
const serviceClient = createClient(supabaseUrl, secretKey, {
  auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
});

const handler = createAccountDeletionHandler({
  async authenticate(token) {
    const { data, error } = await authClient.auth.getUser(token);
    return error || !data.user ? null : { id: data.user.id };
  },
  async createOrResumeRequest(userId) {
    const inserted = await serviceClient
      .from("account_deletion_requests")
      .insert({ status: "processing", user_id: userId })
      .select("id")
      .single();

    if (!inserted.error && inserted.data) {
      return inserted.data.id;
    }
    if (inserted.error?.code !== "23505") {
      throw inserted.error ?? new Error("Deletion request could not be created.");
    }

    const existing = await serviceClient
      .from("account_deletion_requests")
      .select("id")
      .eq("user_id", userId)
      .eq("status", "processing")
      .single();
    if (existing.error || !existing.data) {
      throw existing.error ?? new Error("Deletion request could not be resumed.");
    }
    return existing.data.id;
  },
  async markCompleted(requestId) {
    const { error } = await serviceClient
      .from("account_deletion_requests")
      .update({ completed_at: new Date().toISOString(), failure_code: null, status: "completed" })
      .eq("id", requestId);
    if (error) throw error;
  },
  async markFailed(requestId) {
    const { error } = await serviceClient
      .from("account_deletion_requests")
      .update({ completed_at: null, failure_code: "auth_soft_delete_failed", status: "failed" })
      .eq("id", requestId);
    if (error) throw error;
  },
  async softDeleteUser(userId) {
    const { error } = await serviceClient.auth.admin.deleteUser(userId, true);
    if (error) throw error;
  },
});

Deno.serve(handler);
