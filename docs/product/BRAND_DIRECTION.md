# Billy Brand and Interface Direction

## Supplied References

- [Billy mark](references/billy-mark.png)
- [Billy wordmark](references/billy-wordmark.png)
- [Dashboard concept](references/dashboard-concept.png)

These images are the visual brief. They are not yet production-ready app assets: the mark and wordmark are raster images on a textured green background. Obtain or recreate an approved transparent SVG/vector master before generating final icons, splash assets, print material, or store listings.

## Visual Character

Billy should feel:

- trustworthy and financially responsible;
- modern, calm, and friendly;
- fast and uncluttered;
- consistent across Android and iOS without ignoring native platform behavior.

The round `b` mark should carry recognition. The script wordmark is for brand moments, not body copy or navigation labels.

## Provisional Color Tokens

The green sampled from the supplied brand references averages approximately `#146237`.

| Token | Provisional value | Use |
|---|---|---|
| `brand.primary` | `#146237` | Main brand surfaces and primary actions |
| `brand.deep` | `#0B4829` | Dark gradients, pressed states, high-emphasis backgrounds |
| `brand.action` | `#258F62` | Interactive accents on dark green surfaces |
| `brand.mint` | `#E8F5EC` | Quick-action tiles and subtle success surfaces |
| `surface.canvas` | `#F7F8FA` | App background |
| `surface.card` | `#FFFFFF` | Cards and sheets |
| `text.primary` | `#151A17` | Primary text |
| `text.muted` | `#69736D` | Secondary text |
| `border.subtle` | `#E5EAE7` | Dividers and input borders |
| `status.success` | `#168454` | Confirmed success |
| `status.warning` | `#B7791F` | Pending and attention |
| `status.danger` | `#C43D3D` | Destructive/error states |

All final token pairs must pass WCAG contrast checks. Do not place pale green text on white or white text on mid-green without verification.

## Dashboard Interpretation

Retain from the reference:

- generous safe-area spacing and a compact greeting header;
- a prominent green wallet card with balance visibility control;
- `Add Money` and `Withdraw` as clear wallet actions;
- a six-item quick-action grid;
- one restrained promotional/education banner;
- recent activity directly on Home;
- a five-item bottom navigation.

Adapt for Billy:

- quick actions become Bills, Gift Cards, Crypto, Foreign Numbers, Social Boost, and More;
- bottom navigation becomes Home, Activity, Cards, Services, and Account;
- avoid the floating chat button unless a real support channel is selected;
- banners must communicate live value, safety guidance, or service status rather than act as visual filler;
- sensitive balances default according to the user's privacy preference and remain hidden in app-switcher snapshots where practical.

## Component Principles

- Use an 8-point spacing system and a small, documented radius scale.
- Prefer one strong primary action per screen.
- Use bottom sheets for short mobile choices and full screens for multi-step financial forms.
- Put fees, exchange rates, delivery expectations, and refund rules before confirmation.
- Require a final review screen and transaction PIN for value-moving operations.
- Use skeletons for loading, explicit empty states, and actionable error messages.
- Never communicate status by color alone.
- Respect dynamic text sizing, reduced motion, screen readers, safe areas, and minimum touch targets.

## Motion

- Keep splash/logo motion short and subtle.
- Use motion to explain navigation, confirmation, and state changes.
- Avoid celebratory animation for pending or merely submitted financial transactions.
- Success animation occurs only after Billy has authoritative settlement evidence.

## Asset Work Needed

Before final visual implementation:

1. obtain the original vector logo or approve a traced vector recreation;
2. export white, primary-green, black, and monochrome variants;
3. export mark-only and horizontal wordmark lockups;
4. define clear-space and minimum-size rules;
5. generate iOS, Android adaptive, Android monochrome, notification, favicon, splash, and store assets;
6. confirm wordmark font/licensing or preserve it as vector outlines;
7. test the mark at 16–24 px, where the internal cuts may need optical simplification.
