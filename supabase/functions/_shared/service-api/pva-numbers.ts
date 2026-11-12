import { NumberProviderError } from "../providers/getatext.ts";
import type {
  PvaOutcome,
  PvaSelection,
  PvaService,
} from "../providers/pvadeals.ts";
import {
  type NumberOrder,
  numberPrice,
  type NumberRuntime,
  OperationsError,
  requestText,
} from "./number-service.ts";
import { retryNumberWrite } from "./number-recovery.ts";

export type SmsRouting = {
  primary_provider: "pvadeals" | "getatext" | "off";
  version: number;
};
export const smsRouting = (runtime: NumberRuntime) =>
  runtime.database.rpc<SmsRouting>("internal_sms_routing", {});
type PvaQuote = {
  request: PvaSelection;
  name: string;
  amountMinor: number;
  feeMinor: number;
  maximumMicroUsd: number;
};
type PvaBasket = { items: PvaQuote[] };
type PvaCheckout = { checkoutId: string; totalMinor: number; orders: NumberOrder[] };
const publicCheckout = (checkout: PvaCheckout | null) => checkout && ({
  ...checkout,
  orders: checkout.orders.map(({ user_id: _user, ...order }) => order),
});
type Context = {
  order: NumberOrder;
  receiptId?: number;
  claimed?: boolean;
  claimToken?: string;
  route?: {
    provider_id: string | null;
    dispatched_at: string | null;
    request: PvaSelection;
    maximum_micro_usd: number;
  };
};
const fail = (message: string) =>
  new OperationsError(503, "unavailable", message, true);

async function cached<T>(
  runtime: NumberRuntime,
  key: string,
  fetchData: () => Promise<T>,
): Promise<T> {
  const cache = await runtime.database.rpc<
    { data: T | null; lease: string | null }
  >("internal_pva_cache", { p_key: key });
  if (!cache.lease) {
    if (cache.data === null) {
      throw fail("Checking availability. Please try again in a moment.");
    }
    return cache.data;
  }
  try {
    const value = await fetchData();
    await runtime.database.rpc("internal_pva_cache", {
      p_key: key,
      p_payload: value,
      p_lease: cache.lease,
    });
    return value;
  } catch (error) {
    if (cache.data !== null) return cache.data;
    throw error;
  }
}
async function handlePvaBasket(action: string, input: Record<string, unknown>, userId: string, runtime: NumberRuntime): Promise<{ data: unknown }> {
  if (!runtime.pva) throw fail("Numbers are temporarily unavailable.");
  if (action === "numbers.basket.quote") {
    if (!Array.isArray(input.productIds) || input.productIds.length < 1 || input.productIds.length > 10) {
      throw new OperationsError(400, "invalid_request", "Choose up to 10 services.");
    }
    const ids = input.productIds.map((id) => requestText(id, "Service", 32)).sort();
    if (new Set(ids).size !== ids.length || ids.some((id) => !/^[a-f0-9]{32}$/.test(id))) {
      throw new OperationsError(400, "invalid_request", "Choose each service only once.");
    }
    const rows = await catalog(runtime);
    const handles = await Promise.all(rows.map((row) => publicId(runtime, row)));
    const selectedRows = ids.map((id) => rows[handles.indexOf(id)]);
    if (selectedRows.some((row) => !row || !row.prices['0'])) throw fail("A selected service is no longer available. Change your selection.");
    if (new Set(selectedRows.map((row) => row.country)).size !== 1) {
      throw new OperationsError(400, "invalid_request", "Choose services from one country.");
    }
    // Resolve catalogue handles once, then check each authoritative live price.
    // At most 10 read-only calls; no per-keystroke or per-selection requests.
    const items: PvaQuote[] = await Promise.all(selectedRows.map(async (row) => {
      const live = await runtime.pva!.service(row.id), micros = live.prices['0'];
      if (!micros || live.country !== row.country) throw fail(`${row.name} is out of stock. Change your selection.`);
      const price = priced(runtime, micros);
      return {request:{serviceId:row.id,country:row.country,duration:0}, name:row.name,
        amountMinor:price.amountMinor, feeMinor:price.feeMinor, maximumMicroUsd:micros};
    }));
    const total = items.reduce((sum, item) => sum + BigInt(item.amountMinor) + BigInt(item.feeMinor), 0n);
    if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw fail("Checkout total is too large.");
    return { data: {
      quoteToken: await runtime.tokens.issueOpaque("pva_basket_quote", userId, { items }, 5 * 60_000),
      country: items[0].request.country,
      duration: 0,
      totalMinor: Number(total),
      items: items.map((item, index) => ({ productId: ids[index], name: item.name, totalMinor: item.amountMinor + item.feeMinor })),
    } };
  }
  if (action === "numbers.checkout" || action === "numbers.checkout.status") {
    const key = requestText(input.idempotencyKey, "Request key", 128);
    if (!/^[A-Za-z0-9:_-]{16,128}$/.test(key)) throw new OperationsError(400, "invalid_request", "Invalid request key.");
    if (action === "numbers.checkout.status") {
      return { data: publicCheckout(await runtime.database.rpc<PvaCheckout | null>("internal_pva_checkout", { p_user_id: userId, p_key: key })) };
    }
    const basket = await runtime.tokens.readOpaque<PvaBasket>(
      requestText(input.quoteToken, "Quote", 16000), "pva_basket_quote", userId,
    );
    const created = await runtime.database.rpc<PvaCheckout>("internal_pva_checkout", {
      p_user_id: userId, p_key: key, p_items: basket.items,
    });
    // One checkout, independent rentals. Retain the proven single-order journal
    // instead of guessing batch partial-allocation semantics. Durable cron takes
    // over if this HTTP request is interrupted. Never parallelize paid requests.
    const deadline = Date.now() + 25_000;
    for (const order of created.orders) {
      if (Date.now() >= deadline) break;
      await refreshPvaNumber(runtime, userId, order.id).catch(() => undefined);
    }
    return { data: publicCheckout(await runtime.database.rpc<PvaCheckout>("internal_pva_checkout", { p_user_id: userId, p_key: key })) };
  }
  throw new OperationsError(400, "invalid_request", "Unknown checkout action.");
}
async function catalog(runtime: NumberRuntime) {
  if (!runtime.pva) throw fail("Numbers are temporarily unavailable.");
  const [rows, disabled] = await Promise.all([
    cached(runtime, "catalog", () => runtime.pva!.services()),
    runtime.database.rpc<{ item_id: string }[]>("internal_catalog_disabled", {
      p_service_key: "foreign_numbers",
    }),
  ]);
  const excluded = new Set(disabled.map((r) => r.item_id));
  return rows.filter((s) =>
    !excluded.has(s.id) && !excluded.has(`pvadeals.${s.id}`) &&
    Object.keys(s.prices).length
  );
}
async function publicId(runtime: NumberRuntime, service: PvaService) {
  return (await runtime.digest(`sms-service:${service.country}:${service.id}`))
    .slice(0, 32);
}
async function selected(
  runtime: NumberRuntime,
  input: Record<string, unknown>,
) {
  const id = requestText(input.productId, "Service", 32);
  const rows = await catalog(runtime);
  const ids = await Promise.all(rows.map((s) => publicId(runtime, s)));
  const row = rows[ids.indexOf(id)];
  if (!row) throw fail("This service is no longer available. Choose another.");
  const duration = Number(input.duration);
  if (
    !Number.isInteger(duration) || !row.prices[String(duration)] ||
    (duration && row.country !== "GB")
  ) throw fail("Choose an available rental duration.");
  return { row, duration };
}
function priced(runtime: NumberRuntime, micros: number) {
  return numberPrice(
    micros,
    runtime.exchangeRateMinorPerUsd ?? 0,
    runtime.markupBps ?? -1,
  );
}
export async function handlePvaStore(
  action: string,
  input: Record<string, unknown>,
  userId: string,
  runtime: NumberRuntime,
): Promise<{ data: unknown }> {
  if (!runtime.pva) throw fail("Numbers are temporarily unavailable.");
  if (["numbers.basket.quote", "numbers.checkout", "numbers.checkout.status"].includes(action)) {
    return handlePvaBasket(action, input, userId, runtime);
  }
  if (action === "numbers.market") {
    const rows = await catalog(runtime);
    const services = await Promise.all(rows.map(async (s) => ({
      id: await publicId(runtime, s),
      name: s.name,
      country: s.country,
      prices: Object.fromEntries(
        Object.entries(s.prices).map((
          [duration, micros],
        ) => [duration, priced(runtime, micros).totalMinor]),
      ),
    })));
    return {
      data: {
        services,
        countries: [...new Set(rows.map((s) => s.country))].sort(),
        refreshedAt: new Date().toISOString(),
      },
    };
  }
  if (action === "numbers.locations") {
    const { row, duration } = await selected(runtime, input);
    if (row.country !== "US" || duration) return { data: { locations: [] } };
    // The provider has a global 10/5-minute inventory limit. A refused read only
    // removes optional targeting; it must never block nationwide checkout.
    const locations = await cached(
      runtime,
      `inventory:${row.id}`,
      () => runtime.pva!.inventory(row.id),
    );
    return { data: { locations } };
  }
  if (action === "numbers.quote") {
    const { row, duration } = await selected(runtime, input);
    const state = input.state === undefined || input.state === ""
      ? undefined
      : requestText(input.state, "Location", 2);
    if (state && (row.country !== "US" || !/^[A-Z]{2}$/.test(state))) {
      throw fail("Choose a valid location.");
    }
    if (state) {
      const locations = await cached(
        runtime,
        `inventory:${row.id}`,
        () => runtime.pva!.inventory(row.id),
      );
      if (!locations.some((l) => l.code === state)) {
        throw fail("This location is out of stock. Choose any location.");
      }
    }
    const live = await runtime.pva.service(row.id),
      micros = live.prices[String(duration)];
    if (!micros || live.country !== row.country) {
      throw fail("This rental is out of stock. Choose another service.");
    }
    const price = priced(runtime, micros);
    const quote: PvaQuote = {
      request: {
        serviceId: row.id,
        country: row.country,
        duration,
        ...(state ? { state } : {}),
      },
      name: row.name,
      amountMinor: price.amountMinor,
      feeMinor: price.feeMinor,
      maximumMicroUsd: micros,
    };
    const quoteToken = await runtime.tokens.issueOpaque(
      "pva_number_quote",
      userId,
      quote,
      5 * 60_000,
    );
    return {
      data: {
        quoteToken,
        name: row.name,
        country: row.country,
        duration,
        totalMinor: price.totalMinor,
      },
    };
  }
  if (action === "numbers.buy") {
    const key = requestText(input.idempotencyKey, "Request key", 128);
    if (!/^[A-Za-z0-9:_-]{16,128}$/.test(key)) {
      throw new OperationsError(400, "invalid_request", "Invalid request key.");
    }
    const quote = await runtime.tokens.readOpaque<PvaQuote>(
      requestText(input.quoteToken, "Quote", 8000),
      "pva_number_quote",
      userId,
    );
    const created = await runtime.database.rpc<NumberOrder>(
      "internal_pva_create",
      { p_user_id: userId, p_input: { ...quote, idempotencyKey: key } },
    );
    // Reservation and dispatch recovery remain addressable by this stable order.
    // A failed acknowledgement never creates a replacement purchase.
    const order = await refreshPvaNumber(runtime, userId, created.id).catch(
      () => created,
    );
    const { user_id: _user, ...publicOrder } = order ?? created;
    return { data: publicOrder };
  }
  throw new OperationsError(400, "invalid_request", "Unknown number action.");
}

export async function refreshPvaNumber(
  runtime: NumberRuntime,
  userId: string,
  orderId: string,
  cancel = false,
): Promise<NumberOrder | undefined> {
  if (!runtime.pva) return undefined;
  const context = await runtime.database.rpc<Context | null>(
    "internal_pva_context",
    {
      p_user_id: userId,
      p_order_id: orderId,
      p_claim: true,
      p_cancel: cancel,
    },
  );
  if (!context) return undefined;
  if (context.receiptId) {
    return retryNumberWrite(() =>
      runtime.database.rpc<NumberOrder>("internal_pva_apply", {
        p_user_id: userId,
        p_order_id: orderId,
        p_receipt: context.receiptId,
      })
    );
  }
  if (!context.claimed || !context.claimToken || !context.route) {
    return context.order;
  }
  const route = context.route;
  let outcome: PvaOutcome, raw: string | undefined, purchaseStarted = false;
  try {
    if (!route.dispatched_at) {
      // Queued quotes are checked again immediately before the one-shot purchase.
      const service = await runtime.pva.service(route.request.serviceId);
      const price = service.prices[String(route.request.duration)];
      if (
        context.order.cancel_requested || !price ||
        price > route.maximum_micro_usd ||
        service.country !== route.request.country
      ) {
        outcome = { state: "rejected" };
      } else {
        purchaseStarted = true;
        ({ outcome, raw } = await runtime.pva.purchase(route.request));
      }
    } else if (route.provider_id) {
      ({ outcome, raw } = await runtime.pva.request(
        route.provider_id,
        route.request,
      ));
      if (context.order.cancel_requested && outcome.canCancel) {
        await runtime.pva.flag(route.provider_id);
        // GET may still be cached for 5s. A later poll confirms the terminal flag;
        // the POST's boolean alone never mutates the customer's wallet.
        ({ outcome, raw } = await runtime.pva.request(
          route.provider_id,
          route.request,
        ));
      }
    } else outcome = { state: "unknown" };
  } catch (error) {
    const known = error instanceof NumberProviderError ? error : undefined;
    raw = known?.evidence?.response;
    outcome = route.provider_id
      ? { state: "unknown", rentalId: route.provider_id }
      : !route.dispatched_at && !purchaseStarted
      ? { state: "rejected" }
      : known?.evidence?.code === "PVA_THROTTLED"
      ? { state: "throttled" }
      : known && !known.uncertain
      ? { state: "rejected" }
      : { state: "unknown" };
  }
  const evidence = {
    ...outcome,
    digest: await runtime.digest(
      JSON.stringify({ outcome, claim: context.claimToken }),
    ),
  };
  // Keep emergency evidence within the cipher's 24 KiB limit even for a busy
  // long rental. Full normalized messages are journaled below; logs need only
  // the authenticated rental identity/state to recover a missing DB write.
  const { messages: _messages, ...recoveryEvidence } = evidence;
  const ciphertext = runtime.receiptCipher
    ? await runtime.receiptCipher.encrypt({
      outcome: recoveryEvidence,
      response: raw?.slice(0, 2000),
      responseDigest: raw ? await runtime.digest(raw) : undefined,
    })
    : null;
  let receipt: number;
  try {
    receipt = await retryNumberWrite(() =>
      runtime.database.rpc<number>("internal_pva_record", {
        p_user_id: userId,
        p_order_id: orderId,
        p_claim: context.claimToken,
        p_outcome: evidence,
        p_ciphertext: ciphertext,
      })
    );
  } catch {
    console.error("pva_receipt_persistence_failed", {
      order_id: orderId,
      digest: evidence.digest,
      receipt_ciphertext: ciphertext,
    });
    throw fail(
      "Your request is being checked. Open My numbers before trying again.",
    );
  }
  return retryNumberWrite(() =>
    runtime.database.rpc<NumberOrder>("internal_pva_apply", {
      p_user_id: userId,
      p_order_id: orderId,
      p_receipt: receipt,
    })
  );
}
