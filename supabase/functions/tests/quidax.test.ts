import {
  normalizeNetworkId,
  normalizeQuidaxAssets,
  normalizeTokenAmount,
  QuidaxMockAdapter,
  validateCryptoAddress,
} from "../_shared/providers/quidax.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("Quidax normalizes dynamic wallets and network availability", () => {
  const assets = normalizeQuidaxAssets({
    data: {
      wallets: [
        {
          balance: "25.50",
          blockchain_enabled: true,
          currency: "usdt",
          is_crypto: true,
          locked: "1",
          name: "Tether",
          networks: [
            {
              deposits_enabled: true,
              name: "TRON",
              network: "TRC-20",
              withdraws_enabled: true,
            },
            {
              deposits_enabled: false,
              name: "Disabled",
              network: "disabled",
              withdraws_enabled: false,
            },
          ],
        },
      ],
    },
  });
  assert(assets.length === 1, "Expected one dynamic asset.");
  assert(assets[0].symbol === "USDT", "Asset symbol was not normalized.");
  assert(assets[0].networks.length === 1, "Disabled networks escaped.");
  assert(assets[0].networks[0].id === "trc20", "Network was not normalized.");
});

Deno.test("Quidax validates amounts, network names and destination addresses", () => {
  assert(normalizeNetworkId("TRC-20") === "trc20", "TRC20 mismatch.");
  assert(normalizeTokenAmount("001.2500") === "1.25", "Amount mismatch.");
  assert(
    validateCryptoAddress(
      "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
      "trc20",
    ) === null,
    "Valid TRON address was rejected.",
  );
  assert(
    validateCryptoAddress("0x1234", "erc20") !== null,
    "Invalid EVM address was accepted.",
  );
});

Deno.test("Quidax mock completes the full pre-key portfolio and transaction journey", async () => {
  const adapter = new QuidaxMockAdapter({ scenario: "succeeded" });
  const user = await adapter.createSubaccount({
    email: "preview@billy.test",
    firstName: "Billy",
    idempotencyKey: "quidax-test-profile-0001",
    lastName: "Tester",
  });
  const assets = await adapter.getAssets("buy", user.providerUserId);
  const asset = assets[0];
  const network = asset.networks[0];
  const address = await adapter.getAddress({
    asset: asset.symbol,
    network: network.id,
    providerUserId: user.providerUserId,
  });
  assert(
    address.state === "ready" && address.address,
    "Address is unavailable.",
  );

  const buyQuote = await adapter.quoteBuy({
    asset: asset.symbol,
    fiatAmountMinor: 100_000,
    network: network.id,
  });
  const buy = await adapter.initiateBuy({
    asset: asset.symbol,
    fiatAmountMinor: buyQuote.fiatAmountMinor,
    idempotencyKey: "quidax-test-buy-0001",
    network: network.id,
    walletAddress: address.address,
  });
  assert(buy.state === "succeeded", "Preview buy did not complete.");

  const sellQuote = await adapter.quoteSell({
    asset: asset.symbol,
    network: network.id,
    tokenAmount: "1",
  });
  assert(sellQuote.fiatAmountMinor > 0, "Preview sell quote is invalid.");
  const sell = await adapter.initiateSell({
    asset: asset.symbol,
    idempotencyKey: "quidax-test-sell-0001",
    network: network.id,
    tokenAmount: "1",
  });
  assert(sell.state === "pending", "Sell must await ramp settlement.");

  const sendQuote = await adapter.getSendQuote({
    asset: asset.symbol,
    network: network.id,
    providerUserId: user.providerUserId,
    tokenAmount: "1",
  });
  assert(Number(sendQuote.availableBalance) > 0, "Balance is unavailable.");
  const sent = await adapter.send({
    address: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
    asset: asset.symbol,
    idempotencyKey: "quidax-test-send-0001",
    network: network.id,
    providerUserId: user.providerUserId,
    tokenAmount: "1",
  });
  assert(sent.state === "succeeded", "Preview send did not complete.");
});
