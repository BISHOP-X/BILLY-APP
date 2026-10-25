import assert from "node:assert/strict";
import {
  type BankRecipient,
  type PayoutAdapter,
  payoutMoney,
  PocketFiPayoutAdapter,
} from "../_shared/providers/pocketfi-payout.ts";
import {
  handleWithdrawalAction,
  refreshWithdrawal,
  type Withdrawal,
  type WithdrawalDatabase,
  type WithdrawalRuntime,
} from "../_shared/service-api/withdrawal-service.ts";
import {
  createHmacHexDigester,
  ServiceTokenCodec,
} from "../_shared/service-api/tokens.ts";
import { SecretPayloadCipher } from "../_shared/service-api/payload-cipher.ts";
const recipient: BankRecipient = {
  bankCode: "000001",
  bankName: "Synthetic Bank",
  accountNumber: "0000000000",
  accountName: "SYNTHETIC TESTER",
};
const user = { id: "a6250000-0000-4000-8000-000000000001" };
const secret = "withdrawal-test-secret-with-32-characters-only";
const json = (v: unknown) =>
  new Response(JSON.stringify(v), {
    headers: { "Content-Type": "application/json" },
  });

Deno.test("payout catalogue quarantines conflicting codes and preserves provider bank identities", async () => {
  let calls = 0;
  const api = new PocketFiPayoutAdapter(
    "synthetic-token",
    undefined,
    (() => {
      calls++;
      return Promise.resolve(json({
        banks: [
          { code: "001", name: "Synthetic Bank." },
          { code: "001", name: "Synthetic Bank." },
          { code: "2", name: "Conflicting One" },
          { code: "2", name: "Conflicting Two" },
          { code: "bad", name: "Invalid code" },
          { code: "000003", name: "Another Bank" },
        ],
      }));
    }) as typeof fetch,
  );
  assert.deepEqual(await api.banks(), [
    { code: "000003", name: "Another Bank" },
    { code: "001", name: "Synthetic Bank" },
  ]);
  await api.banks();
  assert.equal(calls, 1);
});
Deno.test("account verification requires the requested bank and a real returned account name", async () => {
  let wrong = false;
  const api = new PocketFiPayoutAdapter(
    "synthetic-token",
    undefined,
    ((url) =>
      Promise.resolve(
        String(url).endsWith("bank-list")
          ? json({ banks: [{ code: "000001", name: "Synthetic Bank" }] })
          : json({
            status: "success",
            account_name: "SYNTHETIC TESTER",
            bank_code: wrong ? "009999" : "000001",
          }),
      )) as typeof fetch,
  );
  assert.deepEqual(await api.resolve("000001", "0000000000"), recipient);
  wrong = true;
  await assert.rejects(() => api.resolve("000001", "0000000000"));
});
Deno.test("payout send never trusts HTTP success or Completed alone; exact submission terms required", async () => {
  let mode = "valid", calls = 0;
  const api = new PocketFiPayoutAdapter(
    "synthetic-token",
    undefined,
    ((_url, init) => {
      calls++;
      assert.deepEqual(JSON.parse(String(init?.body)), {
        account_name: recipient.accountName,
        account_number: recipient.accountNumber,
        bank_code: recipient.bankCode,
        amount: "100",
      });
      if (mode === "timeout") throw new Error("Synthetic timeout");
      return Promise.resolve(json(
        mode === "empty" ? { status: true } : {
          status: true,
          transaction: {
            reference: "PFI|SYNTHETIC01",
            amount: mode === "amount" ? "101" : "100",
            fee: mode === "fee" ? "50" : "30",
            status: "Completed",
            account: recipient.accountNumber,
          },
        },
      ));
    }) as typeof fetch,
  );
  assert.equal((await api.send(recipient, 10000, 3000)).state, "pending");
  for (mode of ["fee", "amount", "empty", "timeout"]) {
    assert.equal((await api.send(recipient, 10000, 3000)).state, "review");
  }
  assert.equal(calls, 5, "Every invocation makes at most one send attempt");
});
Deno.test("confirmation matches payment ID/account/amount and keeps ambiguous failures under review", async () => {
  let status = "Completed", change = "";
  const api = new PocketFiPayoutAdapter(
    "synthetic-token",
    undefined,
    (() =>
      Promise.resolve(json({
        status,
        payment_id: change === "reference" ? "PFI|ANOTHER" : "PFI|SYNTHETIC01",
        account: change === "account" ? "1111111111" : recipient.accountNumber,
        amount: change === "amount" ? "101" : "100",
      }))) as typeof fetch,
  );
  assert.equal(
    (await api.confirm("PFI|SYNTHETIC01", recipient, 10000, 3000)).state,
    "succeeded",
  );
  for (change of ["reference", "account", "amount"]) {
    assert.equal(
      (await api.confirm("PFI|SYNTHETIC01", recipient, 10000, 3000)).state,
      "review",
    );
  }
  change = "";
  for (status of ["failed", "unknown", ""]) {
    assert.equal(
      (await api.confirm("PFI|SYNTHETIC01", recipient, 10000, 3000)).state,
      "review",
    );
  }
  status = "Pending";
  assert.equal(
    (await api.confirm("PFI|SYNTHETIC01", recipient, 10000, 3000)).state,
    "pending",
  );
});
Deno.test("payout decimal parsing never rounds money or accepts non-finite values", () => {
  assert.equal(payoutMoney("100.01"), 10001);
  for (const value of ["1.001", "-1", "1e5", NaN, Infinity, null, ""]) {
    assert.equal(payoutMoney(value), null);
  }
});

function fixture(options: { lost?: boolean; wrongPin?: boolean } = {}) {
  let sends = 0, confirms = 0, reservations = 0, claimed = false;
  let stored: Withdrawal | null = null, storedDigest = "", encrypted = "";
  const routes = () => ({
    request_digest: storedDigest,
    encrypted_recipient: encrypted,
    provider_reference: options.lost ? null : "PFI|SYNTHETIC01",
    submitted_fee_minor: 3000,
    submission_verified: !options.lost,
  });
  const db: WithdrawalDatabase = {
    orders: () => Promise.resolve(stored ? [stored] : []),
    existing: () =>
      Promise.resolve(stored ? { order: stored, route: routes() } : null),
    async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
      if (name === "internal_withdrawal_balance") {
        return {
          availableMinor: 2_000_000,
          walletAvailableMinor: 3_000_000,
          enabled: true,
          baseFeeMinor: 3000,
          levyThresholdMinor: 1_000_000,
          levyMinor: 5000,
        } as T;
      }
      if (name === "internal_authorize_transaction_pin") {
        return (options.wrongPin ? null : "synthetic-pin-id") as T;
      }
      if (name === "internal_withdrawal_create") {
        if (stored) return stored as T;
        reservations++;
        storedDigest = String(args.p_request_digest);
        encrypted = String(args.p_encrypted_recipient);
        stored = {
          id: "a6250000-0000-4000-8000-000000000010",
          user_id: user.id,
          transaction_id: "a6250000-0000-4000-8000-000000000020",
          status: "processing",
          amount_minor: Number(args.p_amount_minor),
          fee_minor: Number(args.p_fee_minor),
          bank_name: "Synthetic Bank",
          account_last_four: "0000",
          status_message: "Preparing",
          created_at: new Date().toISOString(),
          completed_at: null,
        };
        return stored as T;
      }
      if (name === "internal_withdrawal_claim") {
        const acquired = args.p_dispatch
          ? !claimed
          : !options.lost && stored?.status !== "succeeded";
        if (args.p_dispatch) claimed = true;
        return { acquired, order: stored, route: routes() } as T;
      }
      if (name === "internal_withdrawal_observe") {
        stored = { ...stored!, status: args.p_status as Withdrawal["status"] };
        return stored as T;
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
  };
  const adapter: PayoutAdapter = {
    banks: () =>
      Promise.resolve([{ code: recipient.bankCode, name: recipient.bankName }]),
    resolve: () => Promise.resolve(recipient),
    send: () => {
      sends++;
      return Promise.resolve(
        options.lost ? { state: "review", submissionVerified: false } : {
          state: "pending",
          reference: "PFI|SYNTHETIC01",
          feeMinor: 3000,
          submissionVerified: true,
        },
      );
    },
    confirm: () => {
      confirms++;
      return Promise.resolve({
        state: "succeeded",
        reference: "PFI|SYNTHETIC01",
        feeMinor: 3000,
        submissionVerified: true,
      });
    },
  };
  const runtime: WithdrawalRuntime = {
    adapter,
    database: db,
    tokens: new ServiceTokenCodec(secret),
    digest: createHmacHexDigester(secret),
    cipher: new SecretPayloadCipher(secret, {
      context: "bank-recipient",
      additionalData: "billy-bank-recipient:v1",
      prefix: "bw1",
    }),
  };
  return { runtime, stats: () => ({ sends, confirms, reservations }) };
}
async function quote(runtime: WithdrawalRuntime, amountMinor = 10000) {
  const resolved = await handleWithdrawalAction(
    "withdrawal.resolve",
    { bankCode: recipient.bankCode, accountNumber: recipient.accountNumber },
    user,
    runtime,
  );
  return (await handleWithdrawalAction(
    "withdrawal.quote",
    {
      recipientToken:
        (resolved.data as { recipientToken: string }).recipientToken,
      amountMinor,
    },
    user,
    runtime,
  )).data as { quoteId: string; feeMinor: number };
}
Deno.test("withdrawal controller resolves, prices, PIN authorizes, dispatches once and settles", async () => {
  const f = fixture(),
    q = await quote(f.runtime),
    input = {
      quoteId: q.quoteId,
      pin: "4827",
      idempotencyKey: "synthetic-withdraw-key-001",
    };
  const order =
    (await handleWithdrawalAction("withdrawal.submit", input, user, f.runtime))
      .data as Withdrawal;
  assert.equal(order.status, "succeeded");
  assert.ok(!("user_id" in order));
  await handleWithdrawalAction("withdrawal.submit", input, user, f.runtime);
  assert.deepEqual(f.stats(), { sends: 1, confirms: 1, reservations: 1 });
});
Deno.test("parallel repeated submits share a reservation and one-way provider claim", async () => {
  const f = fixture(),
    q = await quote(f.runtime),
    input = {
      quoteId: q.quoteId,
      pin: "4827",
      idempotencyKey: "synthetic-concurrent-key-001",
    };
  await Promise.all(
    Array.from(
      { length: 5 },
      () => handleWithdrawalAction("withdrawal.submit", input, user, f.runtime),
    ),
  );
  assert.equal(f.stats().sends, 1);
  assert.equal(f.stats().reservations, 1);
});
Deno.test("lost payout response stays under review; retry and refresh never resend", async () => {
  const f = fixture({ lost: true }),
    q = await quote(f.runtime),
    input = {
      quoteId: q.quoteId,
      pin: "4827",
      idempotencyKey: "synthetic-uncertain-key-01",
    };
  const o =
    (await handleWithdrawalAction("withdrawal.submit", input, user, f.runtime))
      .data as Withdrawal;
  assert.equal(o.status, "review");
  await handleWithdrawalAction("withdrawal.submit", input, user, f.runtime);
  await refreshWithdrawal(f.runtime, user.id, o.id);
  assert.deepEqual(f.stats(), { sends: 1, confirms: 0, reservations: 1 });
});
Deno.test("wrong PIN, forged quote, wrong owner and extra client fee cannot dispatch", async () => {
  const f = fixture({ wrongPin: true }), q = await quote(f.runtime);
  await assert.rejects(() =>
    handleWithdrawalAction(
      "withdrawal.submit",
      {
        quoteId: q.quoteId,
        pin: "1234",
        idempotencyKey: "synthetic-wrong-pin-key-1",
      },
      user,
      f.runtime,
    )
  );
  await assert.rejects(() =>
    handleWithdrawalAction(
      "withdrawal.submit",
      {
        quoteId: q.quoteId + "x",
        pin: "4827",
        idempotencyKey: "synthetic-forged-key-001",
      },
      user,
      f.runtime,
    )
  );
  await assert.rejects(() =>
    handleWithdrawalAction(
      "withdrawal.submit",
      {
        quoteId: q.quoteId,
        pin: "4827",
        idempotencyKey: "synthetic-owner-key-0001",
      },
      { id: "a6250000-0000-4000-8000-000000000002" },
      f.runtime,
    )
  );
  await assert.rejects(() =>
    handleWithdrawalAction(
      "withdrawal.quote",
      { recipientToken: "x", amountMinor: 10000, feeMinor: 0 },
      user,
      f.runtime,
    )
  );
  assert.equal(f.stats().sends, 0);
});
Deno.test("provider-confirmed threshold applies above NGN10,000 and fractional naira is rejected", async () => {
  const f = fixture();
  assert.equal((await quote(f.runtime, 1_000_000)).feeMinor, 3000);
  assert.equal((await quote(f.runtime, 1_000_100)).feeMinor, 8000);
  await assert.rejects(() => quote(f.runtime, 10001));
});
