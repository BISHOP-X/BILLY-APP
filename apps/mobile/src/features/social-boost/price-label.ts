import { formatMinorUnits } from '@/features/wallet/money';
import type { SocialBoostService } from './domain';

// Server-calculated NGN selling rate includes Billy's configured markup.
// The final quantity is priced afresh by the server before payment.
export function boostServicePrice(service: SocialBoostService): string {
  return Number.isSafeInteger(service.priceMinorPerThousand) && service.priceMinorPerThousand > 0
    ? `${formatMinorUnits(service.priceMinorPerThousand)} / 1,000`
    : 'Price unavailable';
}
