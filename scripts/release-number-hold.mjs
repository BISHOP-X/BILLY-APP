// Billy-only incident operation. Requires a separate owner instruction for each
// reference; never used as an automatic unknown-outcome refund policy.
const args = process.argv.slice(2);
const reference = args.find((v) => v.startsWith('--reference='))?.slice(12);
const amount = Number(args.find((v) => v.startsWith('--amount-minor='))?.slice(15));
const commit = args.includes('--commit-owner-approved');
if (!/^BLY-[A-F0-9]{12}$/.test(reference ?? '') || !Number.isSafeInteger(amount) || amount <= 0)
  throw new Error('An exact Billy reference and expected amount in kobo are required.');
const token = process.env.CODEX_SUPABASE_TOKEN_BILLY;
if (!token) throw new Error('Billy management credential required.');
const operation = `
do $incident$
declare
  t public.transactions; o public.number_orders; r private.number_order_routes;
  b public.balance_reservations; w public.wallets; after_wallet public.wallets;
  administrator uuid; prior jsonb;
begin
  -- Match the normal number-settlement lock order; never run a provider call.
  select * into o from public.number_orders where transaction_id =
    (select id from public.transactions where reference='${reference}') for update;
  if o.id is null then raise exception 'Exact number order not found'; end if;
  select * into r from private.number_order_routes where order_id=o.id for update;
  select * into t from public.transactions where id=o.transaction_id for update;
  select * into b from public.balance_reservations where transaction_id=t.id for update;
  select * into w from public.wallets where id=t.wallet_id for update;
  if t.amount_minor+t.fee_minor <> ${amount} or b.amount_minor <> ${amount}
    or t.currency <> 'NGN' or r.provider_key <> 'daisysms'
    or o.user_id <> t.user_id or b.user_id <> t.user_id or w.user_id <> t.user_id
    then raise exception 'Incident identity/amount mismatch'; end if;
  if exists(select 1 from private.admin_audit where action='owner_number_hold_release' and target=t.reference) then
    if t.status <> 'cancelled' or o.status <> 'cancelled' or b.released_at is null
      or b.status='active' or o.refund_minor <> ${amount} then
      raise exception 'Prior release does not reconcile';
    end if;
    return;
  end if;
  if t.status <> 'pending' or o.status <> 'manual_review' or b.status <> 'active'
    or b.captured_at is not null or b.released_at is not null
    or r.rental_id is not null or o.phone_number is not null or o.sms_code is not null
    or exists(select 1 from public.wallet_ledger where transaction_id=t.id) then
    raise exception 'Order changed; requires fresh inspection, no release made';
  end if;
  select user_id into strict administrator from private.admin_membership;
  prior := jsonb_build_object('transaction_status',t.status,'order_status',o.status,
    'reservation_status',b.status,'held_minor',b.amount_minor,'provider_outcome','unknown');
  perform public.internal_financial_release(t.id,'cancelled',
    'Cancelled and refunded. Your held funds are available in your wallet.');
  update public.number_orders set status='cancelled',rental_closed=true,
    refund_minor=${amount},completed_at=now(),updated_at=now(),
    status_message='Cancelled and refunded. Your held funds are available in your wallet.'
    where id=o.id;
  -- This is NOT evidence of provider failure/refund. Retain a separate open case.
  insert into private.provider_requests(transaction_id,provider_key,operation,
    idempotency_key,request_digest,status,response_code)
    values(t.id,r.provider_key,'rental_recovery','owner-release:'||o.id::text,
      r.fingerprint,'unknown','OWNER_RELEASE_PROVIDER_UNRESOLVED');
  insert into private.admin_audit(actor_id,action,target,reason,before_state,after_state)
    values(administrator,'owner_number_hold_release',t.reference,
      'Explicit owner instruction: return held funds for undelivered number; provider outcome remains unresolved. No general loss-absorption policy.',
      prior,jsonb_build_object('transaction_status','cancelled','returned_minor',${amount},
        'provider_outcome','unknown','execution_channel','management_api_owner_instruction'));
  insert into public.notifications(user_id,category,title,body,route)
    values(t.user_id,'refund','Payment returned',
      'Your US number request was cancelled. The held funds are available in your wallet.',
      '/(app)/(tabs)/activity');
  select * into after_wallet from public.wallets where id=w.id;
  if after_wallet.balance_minor <> w.balance_minor
    or after_wallet.reserved_minor <> w.reserved_minor-${amount}
    or after_wallet.available_balance_minor <> w.available_balance_minor+${amount}
    or exists(select 1 from public.wallet_ledger where transaction_id=t.id) then
    raise exception 'Release accounting check failed';
  end if;
end $incident$;
`;
const response = await fetch('https://api.supabase.com/v1/projects/omsrzwwudskxpkyynnxw/database/query', {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ read_only: false, query:
    `begin; set local statement_timeout='20s'; set local lock_timeout='3s';
     ${operation}\n${operation}\nset constraints all immediate;
     ${commit ? 'commit' : 'rollback'};
     select '${commit ? 'COMMITTED' : 'DRY RUN ROLLED BACK'}: exact hold release and replay checks passed' as result;` }),
  signal: AbortSignal.timeout(30_000),
});
if (!response.ok) {
  const failure = await response.json();
  throw new Error(`Release failed (${response.status}): ${failure.message ?? 'unknown error'}`);
}
console.log(JSON.stringify(await response.json()));
