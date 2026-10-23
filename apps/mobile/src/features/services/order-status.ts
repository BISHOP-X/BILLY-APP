import type { ActivityStatus } from '@/features/main/domain';
import type { NumberOrder } from '@/features/numbers/repository';
import type { SocialBoostOrder } from '@/features/social-boost/domain';

type OrderStatusDisplay = { status: ActivityStatus; label: string; refund?: boolean };

function cancelledStatus(refundMinor: number, totalMinor: number): OrderStatusDisplay {
  if (refundMinor > 0) {
    return {
      status: 'refunded', refund: true,
      label: refundMinor >= totalMinor ? 'Cancelled and refunded' : 'Cancelled · partial refund',
    };
  }
  return { status: 'cancelled', label: 'Cancelled · refund pending' };
}

export function numberRefundMinor(order: NumberOrder): number {
  // The deployed short-number settlement atomically refunds before setting
  // cancelled. Older rows predate refund_minor; long rentals need explicit evidence.
  if (order.status === 'cancelled' && (!order.rental_kind || order.rental_kind === 'short')) {
    return order.amount_minor + order.fee_minor;
  }
  return order.refund_minor ?? 0;
}

export function numberOrderStatus(order: NumberOrder): OrderStatusDisplay {
  if (order.status === 'cancelled') return cancelledStatus(numberRefundMinor(order), order.amount_minor + order.fee_minor);
  if (order.cancel_requested && ['waiting', 'processing'].includes(order.status)) {
    return { status: 'pending', label: 'Cancellation requested' };
  }
  if (order.rental_closed) return { status: 'succeeded', label: 'Closed' };
  if (order.status === 'received') return { status: 'succeeded', label: 'Code received' };
  if (order.status === 'waiting') return { status: 'pending', label: order.rental_kind && order.rental_kind !== 'short' ? 'Active' : 'Waiting for code' };
  if (order.status === 'manual_review') return { status: 'pending', label: 'Checking status' };
  return { status: order.status, label: order.status === 'failed' ? 'Failed' : 'Processing' };
}

export function boostOrderStatus(order: SocialBoostOrder): OrderStatusDisplay {
  if (order.status === 'cancelled' || order.status === 'refunded') return cancelledStatus(order.refundMinor, order.totalMinor);
  if (order.status === 'partial') return { status: 'pending', label: order.refundMinor > 0 ? 'Partially delivered · refunded' : 'Partially delivered', refund: order.refundMinor > 0 };
  if (order.status === 'cancellation_requested') return { status: 'pending', label: 'Cancellation requested' };
  if (order.status === 'manual_review') return { status: 'pending', label: 'Checking status' };
  return { status: order.status, label: ({ succeeded: 'Completed', failed: 'Failed', reserved: 'Processing', processing: 'In progress', pending: 'Pending' })[order.status] };
}
