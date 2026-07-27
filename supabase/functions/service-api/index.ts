import { createClient } from "@supabase/supabase-js";
import {
  createPocketFiLiveAdapter,
  createPocketFiMockAdapter,
  type PocketFiAdapter,
  type PocketFiMockScenario,
} from "../_shared/providers/pocketfi.ts";
import {
  createPremblyAdapter,
  type PremblyAdapter,
  type PremblyMockScenario,
} from "../_shared/providers/prembly.ts";
import {
  type VtpassAuth,
  VtpassHttpAdapter,
  VtpassMockAdapter,
  type VtpassMockScenario,
} from "../_shared/providers/vtpass.ts";
import { createServiceDatabase } from "../_shared/service-api/database.ts";
import {
  createServiceApiHandler,
  type ProviderRuntime,
  type VtpassDataServiceKind,
  type VtpassRuntime,
} from "../_shared/service-api/handler.ts";
import {
  createHmacHexDigester,
  ServiceTokenCodec,
} from "../_shared/service-api/tokens.ts";

const BILLY_PROJECT_REF = "omsrzwwudskxpkyynnxw";

function env(name: string): string | undefined {
  const value = Deno.env.get(name)?.trim();
  return value || undefined;
}

function requiredEnv(name: string): string {
  const value = env(name);
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

function providerMode(name: string): "disabled" | "live" | "mock" {
  const value = env(name)?.toLowerCase() ?? "disabled";
  if (value === "disabled" || value === "live" || value === "mock") {
    return value;
  }
  throw new Error(`${name} must be disabled, live or mock.`);
}

function oneOf<T extends string>(
  name: string,
  value: string | undefined,
  values: readonly T[],
  fallback: T,
): T {
  const candidate = value ?? fallback;
  if (!values.includes(candidate as T)) {
    throw new Error(`${name} is invalid.`);
  }
  return candidate as T;
}

function pocketFiRuntime(): ProviderRuntime<PocketFiAdapter> {
  const mode = providerMode("POCKETFI_MODE");
  if (mode === "disabled") return { mode };
  if (mode === "mock") {
    const scenario = oneOf(
      "POCKETFI_MOCK_SCENARIO",
      env("POCKETFI_MOCK_SCENARIO"),
      ["create", "reuse", "failure", "timeout", "invalid_response"] as const,
      "create",
    ) satisfies PocketFiMockScenario;
    return {
      adapter: createPocketFiMockAdapter({ scenario }),
      mode,
    };
  }
  return {
    adapter: createPocketFiLiveAdapter({
      apiToken: requiredEnv("POCKETFI_API_TOKEN"),
      baseUrl: requiredEnv("POCKETFI_BASE_URL"),
      businessId: requiredEnv("POCKETFI_BUSINESS_ID"),
    }),
    mode,
  };
}

function syntheticVtpassMock(): VtpassMockAdapter {
  const purchaseScenario = oneOf(
    "VTPASS_MOCK_PURCHASE_SCENARIO",
    env("VTPASS_MOCK_PURCHASE_SCENARIO"),
    ["delivered", "pending", "failed", "reversed", "unknown"] as const,
    "delivered",
  ) satisfies VtpassMockScenario;
  const requeryScenario = oneOf(
    "VTPASS_MOCK_REQUERY_SCENARIO",
    env("VTPASS_MOCK_REQUERY_SCENARIO"),
    ["delivered", "pending", "failed", "reversed", "unknown"] as const,
    "delivered",
  ) satisfies VtpassMockScenario;

  const fixedVariation = (serviceId: string, amountKobo: number) => [{
    amountKobo,
    code: `synthetic-${serviceId}-plan`,
    fixedPrice: true,
    name: `Synthetic ${serviceId} plan`,
  }];
  return new VtpassMockAdapter({
    categories: [
      { identifier: "airtime", name: "Synthetic Airtime" },
      { identifier: "data", name: "Synthetic Data" },
      { identifier: "electricity-bill", name: "Synthetic Electricity" },
      { identifier: "tv-subscription", name: "Synthetic TV" },
      { identifier: "education", name: "Synthetic Education" },
    ],
    purchaseScenario,
    requeryScenario,
    servicesByCategory: {
      airtime: [
        {
          maximumAmountKobo: 5_000_000,
          minimumAmountKobo: 5_000,
          name: "MTN",
          serviceId: "mtn",
        },
        {
          maximumAmountKobo: 5_000_000,
          minimumAmountKobo: 5_000,
          name: "Airtel",
          serviceId: "airtel",
        },
      ],
      data: [
        { name: "MTN Data", serviceId: "mtn-data" },
        { name: "Airtel Data", serviceId: "airtel-data" },
        { name: "Smile", serviceId: "smile-direct" },
        { name: "Spectranet", serviceId: "spectranet" },
      ],
      "electricity-bill": [
        {
          maximumAmountKobo: 20_000_000,
          minimumAmountKobo: 100_000,
          name: "Ikeja Electric",
          serviceId: "ikeja-electric",
        },
        {
          maximumAmountKobo: 20_000_000,
          minimumAmountKobo: 100_000,
          name: "Eko Electric",
          serviceId: "eko-electric",
        },
      ],
      "tv-subscription": [
        { name: "DStv", serviceId: "dstv" },
        { name: "GOtv", serviceId: "gotv" },
        { name: "StarTimes", serviceId: "startimes" },
        { name: "Showmax", serviceId: "showmax" },
      ],
      education: [
        { name: "WAEC", serviceId: "waec" },
        { name: "JAMB", serviceId: "jamb" },
      ],
    },
    variationsByService: Object.fromEntries(
      [
        "mtn-data",
        "airtel-data",
        "smile-direct",
        "spectranet",
        "dstv",
        "gotv",
        "startimes",
        "showmax",
        "waec",
        "jamb",
      ].map((serviceId, index) => [
        serviceId,
        fixedVariation(serviceId, 50_000 + index * 10_000),
      ]),
    ),
  });
}

function parseVtpassDataServiceKinds(
  value: string,
): Readonly<Record<string, VtpassDataServiceKind>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(
      "VTPASS_DATA_SERVICE_KIND_MAP must be a JSON object.",
    );
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw new Error(
      "VTPASS_DATA_SERVICE_KIND_MAP must be a JSON object.",
    );
  }
  const entries = Object.entries(parsed);
  if (entries.length === 0 || entries.length > 200) {
    throw new Error(
      "VTPASS_DATA_SERVICE_KIND_MAP must contain between 1 and 200 services.",
    );
  }

  const result: Record<string, VtpassDataServiceKind> = {};
  for (const [serviceId, kind] of entries) {
    if (
      serviceId !== serviceId.trim() ||
      serviceId.length < 1 ||
      serviceId.length > 100 ||
      (kind !== "data" && kind !== "internet")
    ) {
      throw new Error(
        "VTPASS_DATA_SERVICE_KIND_MAP contains an invalid service route.",
      );
    }
    result[serviceId] = kind;
  }
  return Object.freeze(result);
}

function vtpassRuntime(): VtpassRuntime {
  const mode = providerMode("VTPASS_MODE");
  if (mode === "disabled") return { dataServiceKinds: {}, mode };
  if (mode === "mock") {
    return {
      adapter: syntheticVtpassMock(),
      dataServiceKinds: {
        "airtel-data": "data",
        "mtn-data": "data",
        "smile-direct": "internet",
        spectranet: "internet",
      },
      mode,
    };
  }

  const authMode = env("VTPASS_AUTH_MODE")?.toLowerCase() ?? "api-keys";
  let auth: VtpassAuth;
  if (authMode === "api-keys") {
    auth = {
      apiKey: requiredEnv("VTPASS_API_KEY"),
      publicKey: requiredEnv("VTPASS_PUBLIC_KEY"),
      secretKey: requiredEnv("VTPASS_SECRET_KEY"),
    };
  } else if (authMode === "basic") {
    auth = {
      mode: "basic",
      password: requiredEnv("VTPASS_PASSWORD"),
      username: requiredEnv("VTPASS_USERNAME"),
    };
  } else {
    throw new Error("VTPASS_AUTH_MODE is invalid.");
  }

  return {
    adapter: new VtpassHttpAdapter({
      auth,
      // Deliberately required because the inspected provider evidence disagrees
      // on the live hostname. Activation must make that choice explicitly.
      baseUrl: requiredEnv("VTPASS_BASE_URL"),
    }),
    dataServiceKinds: parseVtpassDataServiceKinds(
      requiredEnv("VTPASS_DATA_SERVICE_KIND_MAP"),
    ),
    mode,
  };
}

function premblyRuntime(): ProviderRuntime<PremblyAdapter> {
  const mode = providerMode("PREMBLY_MODE");
  if (mode === "disabled") return { mode };
  const mockScenario = oneOf(
    "PREMBLY_MOCK_SCENARIO",
    env("PREMBLY_MOCK_SCENARIO"),
    ["verified", "pending", "rejected", "technical_error"] as const,
    "verified",
  ) satisfies PremblyMockScenario;
  const mockStatusScenario = oneOf(
    "PREMBLY_MOCK_STATUS_SCENARIO",
    env("PREMBLY_MOCK_STATUS_SCENARIO"),
    ["verified", "pending", "rejected", "technical_error"] as const,
    mockScenario,
  ) satisfies PremblyMockScenario;
  return {
    adapter: createPremblyAdapter({
      apiKey: mode === "live" ? requiredEnv("PREMBLY_API_KEY") : undefined,
      baseUrl: mode === "live" ? requiredEnv("PREMBLY_BASE_URL") : undefined,
      mockScenario,
      mockStatusScenario,
      mode,
      // Only the exact provider-confirmed value enables the live network call.
      // Any absent or differently-cased value leaves status polling in the
      // adapter's manual-review path.
      verificationStatusMethod: env("PREMBLY_STATUS_METHOD") === "GET"
        ? "GET"
        : undefined,
    }),
    mode,
  };
}

const supabaseUrl = assertBillyProjectUrl(requiredEnv("SUPABASE_URL"));
const publishableKey = env("SUPABASE_PUBLISHABLE_KEY") ??
  requiredEnv("SUPABASE_ANON_KEY");
const secretKey = env("SUPABASE_SECRET_KEY") ??
  requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
if (publishableKey === secretKey) {
  throw new Error("Billy public and server Supabase keys must be distinct.");
}

const authClient = createClient(supabaseUrl, publishableKey, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
});
const serviceClient = createClient(supabaseUrl, secretKey, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
});
const serviceApiSigningSecret = requiredEnv("SERVICE_API_SIGNING_SECRET");
const tokenCodec = new ServiceTokenCodec(serviceApiSigningSecret);
const digestEvidence = createHmacHexDigester(serviceApiSigningSecret);
const digestIdentity = createHmacHexDigester(
  requiredEnv("KYC_IDENTITY_HMAC_SECRET"),
);

const handler = createServiceApiHandler({
  async authenticateBearer(token) {
    const { data, error } = await authClient.auth.getUser(token);
    if (error || !data.user) return null;
    return {
      email: data.user.email,
      id: data.user.id,
      isAnonymous: data.user.is_anonymous,
    };
  },
  database: createServiceDatabase(serviceClient),
  digestEvidence,
  digestIdentity,
  pocketFi: pocketFiRuntime(),
  prembly: premblyRuntime(),
  tokens: tokenCodec,
  vtpass: vtpassRuntime(),
});

Deno.serve(handler);
