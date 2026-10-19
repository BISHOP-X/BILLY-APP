import {
  type NumberAllocation,
  NumberProviderError,
} from '../providers/getatext.ts';
import type {
  RentalOffer,
  RentalRoute,
} from '../providers/getatext-rentals.ts';
import {
  type NumberOrder,
  numberPrice,
  type NumberQuote,
  type NumberRuntime,
  OperationsError,
  requestPage,
  requestText,
} from './number-service.ts';

type Item = RentalOffer & { amountMinor: number; feeMinor: number };
type Quote = {
  operation: 'new' | 'reuse' | 'renew' | 'recover';
  items: Item[];
  parentId?: string;
  parentRevision?: number;
};
export type RentalContext = {
  order: NumberOrder;
  pendingAllocation?: Record<string, unknown>;
  route: RentalRoute & { providerKey: string; actualMicroUsd?: number };
};
const fail = (message: string) =>
  new OperationsError(400, 'invalid_request', message);
const visible = ({ user_id: _owner, ...order }: NumberOrder) => order;
export async function rentalContext(
  runtime: NumberRuntime,
  userId: string,
  orderId: unknown,
) {
  const id = requestText(orderId, 'Number order', 36);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw fail('Invalid number order.');
  return runtime.database.rpc<RentalContext>('internal_number_context', {
    p_user_id: userId,
    p_order_id: id,
  });
}
function extended(runtime: NumberRuntime) {
  if (!runtime.extended) {
    throw new OperationsError(
      503,
      'unavailable',
      'Numbers are temporarily unavailable.',
    );
  }
  return runtime.extended;
}
async function offerToken(
  runtime: NumberRuntime,
  userId: string,
  offers: RentalOffer[],
  operation: Quote['operation'] = 'new',
  parent?: NumberOrder,
) {
  const items = offers.map((o) => ({
    ...o,
    ...numberPrice(
      o.microUsd,
      runtime.exchangeRateMinorPerUsd ?? 0,
      runtime.markupBps ?? -1,
    ),
    nonRefundableMinor: o.nonRefundableMicroUsd
      ? numberPrice(
        o.nonRefundableMicroUsd,
        runtime.exchangeRateMinorPerUsd ?? 0,
        0,
      ).amountMinor
      : 0,
  }));
  const quote: Quote = {
    operation,
    items,
    ...(parent
      ? { parentId: parent.id, parentRevision: parent.revision ?? 0 }
      : {}),
  };
  return {
    name: offers.map((o) => o.name).join(' + '),
    periodLabel: offers[0].periodLabel,
    kind: offers[0].kind,
    totalMinor: items.reduce((sum, i) => sum + i.amountMinor + i.feeMinor, 0),
    available: offers.every((o) => o.stock === undefined || o.stock > 0),
    quoteToken: await runtime.tokens.issueOpaque(
      'number_extended_quote',
      userId,
      quote,
      5 * 60_000,
    ),
    countryCode: 'US',
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
  };
}
async function allowedOffers(runtime: NumberRuntime, offers: RentalOffer[]) {
  const disabled = await runtime.database.rpc<{ item_id: string }[]>(
    'internal_catalog_disabled',
    { p_service_key: 'foreign_numbers' },
  );
  const blocked = new Set(disabled.map((r) => r.item_id));
  return offers.filter((o) =>
    !blocked.has(o.serviceId) && !blocked.has(`getatext.${o.serviceId}`)
  );
}
export async function refreshExtendedNumber(
  runtime: NumberRuntime,
  userId: string,
  context: RentalContext,
  action: 'refresh' | 'cancel' | 'another' | 'finish' = 'refresh',
) {
  const adapter = extended(runtime);
  const claim = await runtime.database.rpc<
    RentalContext & { claimed: boolean; claimToken: string }
  >('internal_number_manage_claim', {
    p_user_id: userId,
    p_order_id: context.order.id,
    p_interactive: action !== 'refresh',
  });
  if (!claim.claimed) {
    if (action !== 'refresh' && !claim.order.rental_closed) {
      throw fail('This number is being refreshed. Please try again shortly.');
    }
    return claim.order;
  }
  let result: Record<string, unknown> = { state: 'unknown' };
  let customerError: string | undefined;
  try {
    if (claim.route.providerKey !== 'getatext') {
      throw fail('This action is not supported for this number.');
    }
    if (claim.route.kind === 'short') {
      if (action === 'another') {
        if (claim.order.status !== 'received') {
          throw fail('Wait for your first code before requesting another.');
        }
        result = {
          state: await adapter.another(claim.route.rentalId)
            ? 'another'
            : 'unknown',
        };
        if (result.state === 'unknown') {
          customerError =
            'Another code is not available for this rental. Its time may have ended.';
        }
      } else if (action === 'finish') {
        if (claim.order.status !== 'received') {
          throw fail('Wait for your code or request cancellation.');
        }
        result = {
          state: await adapter.finish(claim.route.rentalId)
            ? 'finished'
            : 'unknown',
        };
      } else {
        result = { ...await runtime.adapter!.status(claim.route.rentalId) };
        // A completed code can never turn into an automatic refund.
        if (result.state === 'cancelled') result = { state: 'expired' };
      }
    } else {
      const status = await adapter.inspect(claim.route);
      result = {
        state: status.rental?.state ?? 'unknown',
        endLabel: status.rental?.endLabel,
        messages: status.messages,
      };
      if (action === 'cancel') {
        if (status.messages.length) {
          throw fail(
            'This rental has received messages and cannot be cancelled.',
          );
        }
        result = { ...result, ...await adapter.cancelLong(claim.route) };
      }
    }
  } catch (e) {
    customerError =
      e instanceof OperationsError || e instanceof NumberProviderError
        ? e.message
        : 'We could not refresh this number. Please try again.';
  }
  const order = await runtime.database.rpc<NumberOrder>(
    'internal_number_manage_result',
    {
      p_user_id: userId,
      p_order_id: context.order.id,
      p_claim_token: claim.claimToken,
      p_input: result,
    },
  );
  if (customerError) throw fail(customerError);
  return order;
}
export async function handleExtendedNumberAction(
  action: string,
  input: Record<string, unknown>,
  userId: string,
  runtime: NumberRuntime,
): Promise<{ data: unknown }> {
  const adapter = extended(runtime);
  if (action === 'numbers.long.catalog' || action === 'numbers.reuse.catalog') {
    const page = requestPage(input.page);
    const query = typeof input.query === 'string'
      ? input.query.trim().slice(0, 80).toLowerCase()
      : '';
    let offers: RentalOffer[], parent: NumberOrder | undefined;
    if (action === 'numbers.reuse.catalog') {
      const context = await rentalContext(runtime, userId, input.orderId);
      if (
        context.route.providerKey !== 'getatext' ||
        context.route.kind !== 'short' || !context.route.phoneNumber
      ) throw fail('This number does not support reuse.');
      parent = context.order;
      offers = (await runtime.adapter!.services()).filter((s) => s.stock > 0)
        .map((s) => {
          // Documented exact-number surcharge. Same-service discount only after
          // this user's previous rental is explicitly completed, not just received.
          const same = s.serviceId === context.route.serviceId &&
            context.order.rental_closed && context.order.sms_code &&
            context.route.actualMicroUsd;
          const base = same
            ? BigInt(context.route.actualMicroUsd!)
            : BigInt(s.priceMicroUsd);
          const cost = same ? (base * 3n + 4n) / 5n : (base * 6n + 4n) / 5n;
          return {
            kind: 'short' as const,
            serviceId: s.serviceId,
            name: s.name,
            period: '',
            periodLabel: 'Same number',
            microUsd: Number(cost),
            stock: s.stock,
          };
        });
    } else offers = await adapter.offers();
    const all = (await allowedOffers(runtime, offers)).filter((o) =>
      o.name.toLowerCase().includes(query)
    ).sort((a, b) => Number(a.stock === 0) - Number(b.stock === 0));
    return {
      data: {
        services: await Promise.all(
          all.slice((page - 1) * 40, page * 40).map((o) =>
            offerToken(runtime, userId, [o], parent ? 'reuse' : 'new', parent)
          ),
        ),
        page,
        pages: Math.max(1, Math.ceil(all.length / 40)),
        total: all.length,
      },
    };
  }
  if (action === 'numbers.bundle.quote') {
    if (
      !Array.isArray(input.quoteTokens) || input.quoteTokens.length < 2 ||
      input.quoteTokens.length > 5
    ) throw fail('Choose between two and five services.');
    const quotes = await Promise.all(
      input.quoteTokens.map((t) =>
        runtime.tokens.readOpaque<NumberQuote>(
          requestText(t, 'Quote', 8000),
          'number_quote',
          userId,
        )
      ),
    );
    if (
      quotes.some((q) => q.providerKey && q.providerKey !== 'getatext') ||
      new Set(quotes.map((q) => q.serviceId)).size !== quotes.length
    ) throw fail('Choose different services that support one shared number.');
    const current = await runtime.adapter!.services();
    const offers = quotes.map((q) => {
      const s = current.find((s) => s.serviceId === q.serviceId && s.stock > 0);
      if (!s) {
        throw fail('A selected service is out of stock. Refresh the list.');
      }
      return {
        kind: 'short' as const,
        serviceId: s.serviceId,
        name: s.name,
        period: '',
        periodLabel: 'One shared number',
        microUsd: s.priceMicroUsd,
      };
    });
    if ((await allowedOffers(runtime, offers)).length !== offers.length) {
      throw fail('A selected service is unavailable.');
    }
    return { data: await offerToken(runtime, userId, offers) };
  }
  if (action === 'numbers.rental.options') {
    const context = await rentalContext(runtime, userId, input.orderId);
    if (
      context.route.providerKey !== 'getatext' || context.route.kind === 'short'
    ) return { data: { options: [] } };
    const choices = await adapter.recoverable(context.route).catch((e) => {
      if (!context.order.rental_closed) return []; // Recovery outage cannot hide active renewal.
      throw e;
    });
    const options = await Promise.all(
      choices.map((o) =>
        offerToken(runtime, userId, [o], 'recover', context.order).then(
          (o) => ({ ...o, actionLabel: 'Recover number' }),
        )
      ),
    );
    if (!context.order.rental_closed) {
      const state = await adapter.inspect(context.route);
      if (state.rental?.state === 'active' && state.rental.priceMicroUsd) {
        const o: RentalOffer = {
          kind: context.route.kind,
          serviceId: context.route.serviceId,
          name: context.order.service_name,
          period: context.route.period,
          periodLabel: context.order.rental_period ?? context.route.period,
          microUsd: state.rental.priceMicroUsd,
        };
        options.unshift({
          ...await offerToken(runtime, userId, [o], 'renew', context.order),
          actionLabel: 'Renew number',
        });
      }
    }
    return { data: { options } };
  }
  if (action === 'numbers.messages') {
    await rentalContext(runtime, userId, input.orderId);
    return {
      data: {
        messages: await runtime.database.rpc('internal_number_messages', {
          p_user_id: userId,
          p_order_id: input.orderId,
          p_page: requestPage(input.page),
        }),
      },
    };
  }
  if (action === 'numbers.another' || action === 'numbers.finish') {
    const context = await rentalContext(runtime, userId, input.orderId);
    return {
      data: visible(
        await refreshExtendedNumber(
          runtime,
          userId,
          context,
          action === 'numbers.another' ? 'another' : 'finish',
        ),
      ),
    };
  }
  if (action !== 'numbers.purchase') throw fail('Unknown number action.');
  const pin = requestText(input.pin, 'PIN', 4);
  if (!/^\d{4}$/.test(pin)) {
    throw fail('Enter your four-digit transaction PIN.');
  }
  const key = requestText(input.idempotencyKey, 'Request key', 90);
  if (!/^[A-Za-z0-9:_-]{16,90}$/.test(key)) throw fail('Invalid request key.');
  const quote = await runtime.tokens.readOpaque<Quote>(
    requestText(input.quoteToken, 'Quote', 16000),
    'number_extended_quote',
    userId,
  );
  const context = quote.parentId
    ? await rentalContext(runtime, userId, quote.parentId)
    : undefined;
  const authorizations = [];
  for (const _item of quote.items) {
    const authorization = await runtime.database.rpc<string | null>(
      'internal_authorize_transaction_pin',
      { p_user_id: userId, p_pin: pin },
    );
    if (!authorization) {
      throw new OperationsError(
        403,
        'forbidden',
        'That transaction PIN is incorrect. Please try again.',
      );
    }
    authorizations.push(authorization);
  }
  const created = await runtime.database.rpc<
    { dispatch: boolean; orders: NumberOrder[] }
  >('internal_number_extended_create', {
    p_user_id: userId,
    p_input: { ...quote, authorizations, idempotencyKey: key },
  });
  if (!created.dispatch) {
    return { data: { orders: created.orders.map(visible) } };
  }
  let results: (NumberAllocation & { endLabel?: string })[] = [];
  let state = 'allocated';
  try {
    if (quote.operation === 'reuse' && context) {
      results = [
        await adapter.specific(
          context.route.phoneNumber,
          quote.items[0].serviceId,
          quote.items[0].microUsd,
        ),
      ];
    } else if (quote.operation === 'renew' && context) {
      results = [await adapter.renew(context.route)];
    } else if (quote.operation === 'recover' && context) {
      results = [await adapter.recover(context.route, quote.items[0])];
    } else if (quote.items.length > 1) {
      results = await adapter.multiple(
        quote.items.map((o) => ({ serviceId: o.serviceId, name: o.name })),
        quote.items.reduce((sum, o) => sum + o.microUsd, 0),
      );
    } else results = [await adapter.buy(quote.items[0])];
  } catch (e) {
    state = e instanceof NumberProviderError && !e.uncertain
      ? 'rejected'
      : 'unknown';
  }
  const evidence = await Promise.all(
    created.orders.map(async (_o, i) => ({
      ...results[i],
      state,
      digest: await runtime.digest(JSON.stringify(results[i] ?? { state })),
    })),
  );
  // Store all normalized receipts first. Reconciliation can settle a saved
  // receipt after a crash without repeating any paid provider request.
  await runtime.database.rpc('internal_number_record_results', {
    p_user_id: userId,
    p_idempotency_key: key,
    p_results: evidence,
  });
  const orders: NumberOrder[] = [];
  // Persist each confirmed result independently. If the process is interrupted,
  // unknown children remain held; a retry never issues a second provider order.
  for (let i = 0; i < created.orders.length; i++) {
    orders.push(
      await runtime.database.rpc<NumberOrder>(
        'internal_number_extended_allocate',
        {
          p_user_id: userId,
          p_order_id: created.orders[i].id,
          p_input: evidence[i],
        },
      ),
    );
  }
  return { data: { orders: orders.map(visible) } };
}
