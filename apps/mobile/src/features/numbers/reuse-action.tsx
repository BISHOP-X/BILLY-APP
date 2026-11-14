import { useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { AppButton } from '@/components/ui/button';
import { AddFundsAction } from '@/features/funding/add-funds-action';
import { formatMinorUnits } from '@/features/wallet/money';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { numberRepository, type NumberOrder, type ReuseState } from './repository';

export function ReuseAction({order}:{order:NumberOrder}) {
  const {colors}=useBillyTheme(), qc=useQueryClient();
  const [quote,setQuote]=useState<{quoteToken:string;totalMinor:number}|null>(null);
  const [notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[pending,setPending]=useState(false);
  const lock=useRef(false), key=useRef<string|undefined>(undefined);
  if(order.rental_kind!=='short' || order.supports_extras || order.cancel_requested || !['waiting','received'].includes(order.status)) return null;
  async function showResult(value:ReuseState|null) {
    const waiting=value?.state==='pending'||value?.state==='review';
    setPending(waiting); setQuote(null);
    setNotice(waiting?'Confirming reuse. You will not be charged twice.':value?.state==='confirmed'?'Number reused. Waiting for a new code.':value?.state==='rejected'?'Reuse was not completed. Any held funds are available again.':'No reuse is pending.');
    if(!waiting) key.current=undefined;
    await Promise.all([qc.invalidateQueries({queryKey:['numbers']}),qc.invalidateQueries({queryKey:['main']})]);
  }
  async function run(action:'preview'|'confirm'|'status') {
    if(lock.current)return;
    lock.current=true;setBusy(true);setNotice('');
    try {
      if(action==='preview') {setQuote(await numberRepository.reusePreview(order.id));key.current=undefined;}
      else if(action==='status') await showResult(await numberRepository.reuseStatus(order.id,key.current));
      else if(quote) {
        key.current??=`reuse-${Crypto.randomUUID()}`;
        setPending(true);
        await showResult(await numberRepository.reuseConfirm(order.id,quote.quoteToken,key.current));
      }
    } catch(error) {
      setNotice(error instanceof Error?error.message:'Could not confirm reuse. Check the status before trying again.');
      // A lost response may have charged. Retain the key and offer a read-only check.
      if(action==='confirm')setPending(true);
    } finally {lock.current=false;setBusy(false);}
  }
  return <View style={{gap:10}}>
    {pending?<AppButton label="Check reuse status" variant="secondary" loading={busy} onPress={()=>void run('status')}/>:quote?<>
      <Text style={{color:colors.text}}>Reuse this number for {quote.totalMinor===0?'free':formatMinorUnits(quote.totalMinor,'NGN')}? Availability and price are checked again when you confirm.</Text>
      <AppButton label={quote.totalMinor===0?'Reuse for free':`Confirm · ${formatMinorUnits(quote.totalMinor,'NGN')}`} loading={busy} onPress={()=>void run('confirm')}/>
      <AppButton label="Not now" variant="ghost" disabled={busy} onPress={()=>setQuote(null)}/>
    </>:<AppButton label="Reuse number" variant="secondary" loading={busy} onPress={()=>void run('preview')}/>}
    {notice?<Text accessibilityLiveRegion="polite" style={{color:colors.textMuted}}>{notice}</Text>:null}
    <AddFundsAction message={notice}/>
  </View>;
}
