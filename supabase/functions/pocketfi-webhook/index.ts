import { createClient } from "@supabase/supabase-js";
import {
  createPocketFiWebhookHandler,
  type PocketFiWebhookOutcome,
} from "../_shared/providers/pocketfi-webhook.ts";

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
  if (
    (!isLocal && !isBillyHosted) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("SUPABASE_URL is not the Billy project.");
  }
  return parsed.toString().replace(/\/+$/, "");
}

function webhookMode(): "disabled" | "live" {
  return Deno.env.get("POCKETFI_WEBHOOK_MODE")?.trim().toLowerCase() === "live"
    ? "live"
    : "disabled";
}

function creditableStatuses(): ReadonlySet<string> | undefined {
  const configured = Deno.env.get("POCKETFI_WEBHOOK_CREDITABLE_STATUSES")
    ?.split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return configured?.length ? new Set(configured) : undefined;
}

function isOutcome(value: unknown): value is PocketFiWebhookOutcome {
  return [
    "conflict",
    "credited",
    "duplicate",
    "manual_review",
    "retryable",
  ].includes(String(value));
}

const supabaseUrl = assertBillyProjectUrl(requiredEnv("SUPABASE_URL"));
const secretKey = Deno.env.get("SUPABASE_SECRET_KEY")?.trim() ||
  requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const serviceClient = createClient(supabaseUrl, secretKey, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
});

const handler = createPocketFiWebhookHandler({
  allowStatusless:
    Deno.env.get("POCKETFI_WEBHOOK_ALLOW_STATUSLESS")?.trim().toLowerCase() ===
      "true",
  creditableStatuses: creditableStatuses(),
  database: {
    async processTransfer(input) {
      const { data, error } = await serviceClient.rpc(
        "internal_process_pocketfi_webhook",
        {
          p_account_number: input.accountNumber,
          p_amount_minor: input.amountMinor,
          p_message: "Money added from bank transfer.",
          p_payload_digest: input.payloadDigest,
          p_provider_reference: input.providerReference,
          p_provider_status: input.providerStatus,
        },
      );
      if (error) throw new Error("PocketFi settlement is unavailable.");

      const row = Array.isArray(data) ? data[0] : data;
      if (!row || typeof row !== "object" || !("outcome" in row)) {
        throw new Error("PocketFi settlement returned an invalid result.");
      }
      const outcome = row.outcome;
      if (!isOutcome(outcome)) {
        throw new Error("PocketFi settlement returned an invalid outcome.");
      }
      const transactionId = "transaction_id" in row &&
          typeof row.transaction_id === "string"
        ? row.transaction_id
        : null;
      return { outcome, transactionId };
    },
  },
  mode: webhookMode(),
  signatureSecret: Deno.env.get("POCKETFI_WEBHOOK_SECRET")?.trim() ?? "",
});

Deno.serve(handler);
