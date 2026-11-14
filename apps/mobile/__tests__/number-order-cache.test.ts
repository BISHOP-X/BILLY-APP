import { QueryClient } from '@tanstack/react-query';
import { cacheNumberOrder } from '@/features/numbers/order-cache';
import type { NumberOrder } from '@/features/numbers/repository';
test('acknowledged cancellation immediately replaces orders and transaction copies, not another owner',async()=>{
  const qc=new QueryClient();
  const old={id:'one',status:'waiting'} as NumberOrder, next={...old,status:'cancelled',refund_minor:200} as NumberOrder;
  qc.setQueryData(['numbers','owner','orders',1],{orders:[old]});
  qc.setQueryData(['numbers','owner','transactions','a'],[old]);
  qc.setQueryData(['numbers','other','orders',1],{orders:[old]});
  qc.setQueryData(['numbers','owner','carrier','one'],{carrier:'THREE'});
  await cacheNumberOrder(qc,'owner',next);
  expect(qc.getQueryData(['numbers','owner','orders',1])).toEqual({orders:[next]});
  expect(qc.getQueryData(['numbers','owner','transactions','a'])).toEqual([next]);
  expect(qc.getQueryData(['numbers','other','orders',1])).toEqual({orders:[old]});
  expect(qc.getQueryData(['numbers','owner','carrier','one'])).toEqual({carrier:'THREE'});
  qc.clear();
});
