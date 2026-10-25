/** PocketFi payout contract, separate from the working funding adapter. */
export type Bank = { code: string; name: string };
export type BankRecipient = {
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
};
export type PayoutObservation = {
  state: "pending" | "review" | "succeeded";
  reference?: string;
  feeMinor?: number;
  submissionVerified: boolean;
};
export interface PayoutAdapter {
  banks(): Promise<Bank[]>;
  resolve(bankCode: string, accountNumber: string): Promise<BankRecipient>;
  send(
    recipient: BankRecipient,
    amountMinor: number,
    expectedBaseFeeMinor: number,
  ): Promise<PayoutObservation>;
  confirm(
    reference: string,
    recipient: BankRecipient,
    amountMinor: number,
    submittedFeeMinor: number,
  ): Promise<PayoutObservation>;
}
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const clean = (v: unknown, max = 180) =>
  typeof v === "string" && v.trim().length <= max && !/[\x00-\x1f\x7f]/.test(v)
    ? v.trim().replace(/\s+/g, " ")
    : "";
export function payoutMoney(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value);
  if (!/^\d{1,14}(\.\d{1,2})?$/.test(text)) return null;
  const [whole, cents = ""] = text.split(".");
  const amount = BigInt(whole) * 100n + BigInt(cents.padEnd(2, "0"));
  return amount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amount) : null;
}
export function payoutReference(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9|_-]{6,128}$/.test(value)
    ? value
    : undefined;
}
export class PocketFiPayoutAdapter implements PayoutAdapter {
  private cached?: { until: number; banks: Bank[] };
  constructor(
    private readonly apiToken: string,
    private readonly baseUrl = "https://api.pocketfi.ng/api/v1",
    private readonly transport: typeof fetch = fetch,
  ) {
    if (
      !apiToken || new URL(baseUrl).origin !== "https://api.pocketfi.ng" ||
      !["/api/v1", "/api/test"].includes(
        new URL(baseUrl).pathname.replace(/\/$/, ""),
      )
    ) {
      throw new Error("PocketFi payout configuration is invalid.");
    }
  }
  private async request(path: string, body?: unknown): Promise<unknown> {
    const response = await this.transport(
      this.baseUrl.replace(/\/$/, "") + path,
      {
        method: body === undefined ? "GET" : "POST",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok) {
      throw new Error("Bank service is temporarily unavailable.");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Bank service returned no result.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 512_000) throw new Error("Bank response is too large.");
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  async banks(): Promise<Bank[]> {
    if (this.cached && this.cached.until > Date.now()) {
      return this.cached.banks.map((b) => ({ ...b }));
    }
    const value = await this.request("/payout/bank-list");
    if (!record(value) || !Array.isArray(value.banks)) {
      throw new Error("Bank list is unavailable.");
    }
    const names = new Map<string, Set<string>>();
    for (const bank of value.banks) {
      if (!record(bank)) continue;
      const code = String(bank.code ?? "").trim(),
        name = clean(bank.name).replace(/\.$/, "");
      if (!/^\d{1,20}$/.test(code) || !name) continue;
      const set = names.get(code) ?? new Set<string>();
      set.add(name);
      names.set(code, set);
    }
    const banks = [...names].filter(([, values]) => values.size === 1).map((
      [code, values],
    ) => ({ code, name: [...values][0] }))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!banks.length) throw new Error("Bank list is unavailable.");
    this.cached = { until: Date.now() + 300_000, banks };
    return banks.map((b) => ({ ...b }));
  }
  async resolve(
    bankCode: string,
    accountNumber: string,
  ): Promise<BankRecipient> {
    const bank = (await this.banks()).find((b) => b.code === bankCode);
    if (!bank || !/^\d{10}$/.test(accountNumber)) {
      throw new Error("Choose a bank and enter a 10-digit account number.");
    }
    const value = await this.request("/payout/verify-bank", {
      bank_code: bankCode,
      account_number: accountNumber,
    });
    if (
      !record(value) ||
      !["success", "successful", true].includes(
        value.status as string | boolean,
      ) || !clean(value.account_name) ||
      String(value.bank_code ?? bankCode) !== bankCode ||
      (value.account_number != null && value.account_number !== accountNumber)
    ) {
      throw new Error(
        "We could not verify this bank account. Check the details.",
      );
    }
    return {
      bankCode,
      bankName: bank.name,
      accountNumber,
      accountName: clean(value.account_name),
    };
  }
  async send(
    recipient: BankRecipient,
    amountMinor: number,
    expectedBaseFeeMinor: number,
  ): Promise<PayoutObservation> {
    if (
      !Number.isSafeInteger(amountMinor) || amountMinor <= 0 ||
      amountMinor % 100
    ) throw new Error("Enter an amount in whole naira.");
    // Never retry this POST: no documented provider idempotency field exists.
    try {
      const value = await this.request("/payout/send", {
        account_name: recipient.accountName,
        account_number: recipient.accountNumber,
        bank_code: recipient.bankCode,
        amount: String(amountMinor / 100),
      });
      if (!record(value) || !record(value.transaction)) {
        return { state: "review", submissionVerified: false };
      }
      const tx = value.transaction,
        reference = payoutReference(tx.reference),
        feeMinor = payoutMoney(tx.fee);
      const valid = value.status === true && !!reference &&
        payoutMoney(tx.amount) === amountMinor &&
        feeMinor === expectedBaseFeeMinor &&
        (tx.account == null || tx.account === recipient.accountNumber);
      // Even a Completed submission is confirmed through the dedicated lookup.
      return {
        state: valid ? "pending" : "review",
        reference,
        feeMinor: feeMinor ?? undefined,
        submissionVerified: valid,
      };
    } catch {
      return { state: "review", submissionVerified: false };
    }
  }
  async confirm(
    reference: string,
    recipient: BankRecipient,
    amountMinor: number,
    submittedFeeMinor: number,
  ): Promise<PayoutObservation> {
    const unresolved: PayoutObservation = {
      state: "review",
      reference,
      feeMinor: submittedFeeMinor,
      submissionVerified: true,
    };
    if (!payoutReference(reference)) return unresolved;
    try {
      const value = await this.request("/transaction/confirm", {
        payment_id: reference,
      });
      if (
        !record(value) || value.payment_id !== reference ||
        value.account !== recipient.accountNumber ||
        payoutMoney(value.amount) !== amountMinor
      ) return unresolved;
      const status = typeof value.status === "string"
        ? value.status.toLowerCase().trim()
        : "";
      return {
        ...unresolved,
        state: status === "completed"
          ? "succeeded"
          : ["pending", "processing"].includes(status)
          ? "pending"
          : "review",
      };
    } catch {
      return unresolved;
    }
  }
}
