import {
  normalizePrestmitBuyCatalog,
  normalizePrestmitCodes,
  PrestmitMockAdapter,
} from "../_shared/providers/prestmit.ts";
import { SecretPayloadCipher } from "../_shared/service-api/payload-cipher.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("Prestmit catalog normalization separates gift and prepaid cards dynamically", () => {
  const products = normalizePrestmitBuyCatalog({
    data: {
      giftCards: [
        {
          brand: "Amazon",
          category: "Gift Cards",
          currency: { code: "USD", symbol: "$" },
          maximumAmount: 500,
          minimumAmount: 10,
          sku: "provider-amazon-us",
          title: "Amazon US Gift Card",
        },
        {
          brand: "Visa",
          category: "Virtual Prepaid Cards",
          currency: { code: "USD", symbol: "$" },
          maximumAmount: 1000,
          minimumAmount: 10,
          sku: "provider-visa-usd",
          title: "USD Virtual Visa Card",
        },
      ],
    },
  });

  assert(products.length === 2, "Expected both provider products.");
  assert(
    products.find((product) => product.sku === "provider-amazon-us")?.kind ===
      "gift_card",
    "Gift card was misclassified.",
  );
  assert(
    products.find((product) => product.sku === "provider-visa-usd")?.kind ===
      "prepaid_card",
    "Prepaid card was misclassified.",
  );
});

Deno.test("Prestmit fulfilment normalization exposes only delivery fields", () => {
  const codes = normalizePrestmitCodes({
    data: {
      cards: [{
        cardNumber: "CARD-123",
        claimUrl: "https://example.invalid/claim",
        expireDate: "2030-01-01",
        internalCost: "do-not-expose",
        pinCode: "4567",
      }],
    },
  });

  assert(codes.length === 1, "Expected one delivered card.");
  assert(codes[0].cardNumber === "CARD-123", "Card number was not normalized.");
  assert(codes[0].pin === "4567", "PIN was not normalized.");
  assert(
    !("internalCost" in codes[0]),
    "Provider-only fields escaped the adapter.",
  );
});

Deno.test("Prestmit mock models buy delivery and sell review without network calls", async () => {
  const adapter = new PrestmitMockAdapter({
    buyScenario: "delivered",
    sellScenario: "pending",
  });
  const catalog = await adapter.getBuyCatalog();
  const gift = catalog.find((product) => product.kind === "gift_card");
  assert(gift, "Synthetic gift product is missing.");

  const quote = await adapter.quoteBuy({
    faceValueMinor: gift.minimumFaceValueMinor,
    quantity: 1,
    sku: gift.sku,
  });
  assert(quote.providerAmountMinor > 0, "Synthetic quote is invalid.");

  const purchase = await adapter.createBuyTrade({
    faceValueMinor: gift.minimumFaceValueMinor,
    idempotencyKey: "prestmit-test-buy-0001",
    paymentMethod: "NAIRA",
    quantity: 1,
    sku: gift.sku,
  });
  assert(purchase.state === "delivered", "Buy should be delivered.");
  assert(purchase.codes.length === 1, "Delivery code is missing.");

  const sellProduct = (await adapter.listSellProducts("synthetic-apple"))[0];
  const sale = await adapter.createSellTrade({
    attachments: [],
    ecode: "SYNTHETIC-CODE",
    faceValueMinor: sellProduct.minimumFaceValueMinor,
    idempotencyKey: "prestmit-test-sell-0001",
    payoutMethod: "NAIRA",
    productId: sellProduct.id,
  });
  assert(sale.state === "pending", "Sell should remain under review.");
});

Deno.test("Prestmit stored fulfilment is encrypted and rejects tampering", async () => {
  const cipher = new SecretPayloadCipher("s".repeat(48));
  const encrypted = await cipher.encrypt({
    codes: [{ cardNumber: "CARD-123", pin: "4567" }],
  });
  assert(!encrypted.includes("CARD-123"), "Ciphertext exposed card data.");

  const decrypted = await cipher.decrypt<{
    codes: { cardNumber: string; pin: string }[];
  }>(encrypted);
  assert(
    decrypted.codes[0].cardNumber === "CARD-123",
    "Encrypted fulfilment did not round-trip.",
  );

  const tampered = `${encrypted.slice(0, -1)}${
    encrypted.endsWith("A") ? "B" : "A"
  }`;
  let rejected = false;
  try {
    await cipher.decrypt(tampered);
  } catch {
    rejected = true;
  }
  assert(rejected, "Tampered ciphertext was accepted.");
});
