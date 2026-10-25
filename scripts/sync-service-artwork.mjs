// Build-time artwork sourcing, never a provider catalogue or an allow-list.
// Public brand homepages must identify the brand before their favicon is used.
import { mkdir,writeFile,readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as icons from 'simple-icons';
import ts from 'typescript';
const normalize=s=>s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
const domains={
  '1688':'1688.com','1Q':'1q.com','2RedBeans':'2redbeans.com','3Fun':'go3fun.co','7-Eleven':'7-eleven.com',AARP:'aarp.org',
  Abra:'abra.com',Acima:'acima.com',AEG:'aegworldwide.com','AHEALTH MoneyWalk':'moneywalk.com',Aiperks:'aiperks.com',Airperks:'airperks.com',
  'Albertson (Safeway, Jewel Osco, Vons)':'albertsons.com',ALDI:'aldi.us',Alibaba:'alibaba.com','Alibaba Cloud':'alibabacloud.com',Alignerr:'alignerr.com',Allset:'allsetnow.com',AOL:'aol.com',
  AppsPrize:'appsprize.com','Ashley Madison':'ashleymadison.com','Asian Dating':'asiandating.com',Attapoll:'attapoll.com',Avail:'avail.co',AXS:'axs.com',Badi:'badi.com',Badoo:'badoo.com',Bandai:'bandainamcoent.com',
  'Battle.net':'battle.net',Bemine:'bemine.club',Benjamin:'benjaminone.com',Bestbuy:'bestbuy.com',Bet365:'bet365.com',Betflag:'betflag.it',Bilibili:'bilibili.com',bitFlyer:'bitflyer.com',Bitso:'bitso.com',Bitwage:'bitwage.com',
  BlaBlaCar:'blablacar.com',BlackPeopleMeet:'blackpeoplemeet.com',BLK:'blk-app.com',BlueAcorn:'blueacorn.co',BlueVine:'bluevine.com',Bolt:'bolt.eu',BrandedSurvey:'surveys.gobranded.com',BuildClinical:'buildclinical.com',
  'Burger King':'bk.com',Burner:'burnerapp.com','Capital Bikeshare':'capitalbikeshare.com','Capital One Shopping':'capitaloneshopping.com',Careem:'careem.com','Cash space':'cashspace.com','Cash Up':'cashup.com',
  Cashee:'cashee.com',Cashstar:'cashstar.com',CashWalk:'cashwalklabs.io','Cathay Pacific / Asia Miles':'cathaypacific.com','Catholic Match':'catholicmatch.com',Caviar:'trycaviar.com',Cerca:'cerca.com',
  Chalkboard:'usechalkboard.com',Chamet:'ichamet.com',ChargePoint:'chargepoint.com','Chevron / TexaCo':'chevron.com','Chick-fil-A':'chick-fil-a.com',Chipotle:'chipotle.com',Chispa:'chispa-app.com','chownow.com':'chownow.com',
  Claim:'claim.co',Clapper:'clapperapp.com',ClassPass:'classpass.com',Clear:'clearme.com',Clickatell:'clickatell.com',Cloaked:'cloaked.com',CloudBet:'cloudbet.com',Clubhouse:'clubhouse.com',
  Codashop:'codashop.com','Coffee Meets Bagel / CMB':'coffeemeetsbagel.com',Coinhouse:'coinhouse.com',Coinme:'coinme.com',Cointiply:'cointiply.com',CoinZoom:'coinzoom.com','College Pulse':'collegepulse.com',
  Craigslist:'craigslist.org',Crowdtap:'crowdtap.com','Crumbl Cookies':'crumblcookies.com','Currently.com':'currently.com',Cursor:'cursor.com',Curtsy:'curtsyapp.com',CVS:'cvs.com',Deliveroo:'deliveroo.com',Depop:'depop.com',
  'DICE.FM':'dice.fm',DilMil:'dilmil.co',Ding:'ding.com',DingDingDing:'dingdingding.com',Dingtone:'dingtone.me',DistroKid:'distrokid.com',DocuSign:'docusign.com','Dollar General':'dollargeneral.com',"Domino's":'dominos.com',
  DoorDash:'doordash.com','Dopa Global':'dopaglobal.com',DOSH:'dosh.com',Doublelist:'doublelist.com',DraftKings:'draftkings.com','Driplive / DripShop':'dripshop.live',Dscout:'dscout.com',Duet:'duetapp.com',Duffl:'duffl.com',
  DunkinDonuts:'dunkindonuts.com',Dust:'usedust.com','Dutch Bros':'dutchbros.com',Dynadot:'dynadot.com','Earn Up':'earnup.com',Earnin:'earnin.com',eGifter:'egifter.com',Eharmony:'eharmony.com',EliteSingles:'elitesingles.com',
  Eneba:'eneba.com',EpicNPC:'epicnpc.com',Etsy:'etsy.com',Eureka:'eurekasurveys.com',Eventbrite:'eventbrite.com',Evidation:'evidation.com',FAIRTIQ:'fairtiq.com',Fanatics:'fanatics.com',Fanduel:'fanduel.com',FanTuan:'fantuan.ca',
  FastMail:'fastmail.com',Fave:'myfave.com',Favor:'favordelivery.com',Feeld:'feeld.co','Fetch Rewards':'fetch.com',Finya:'finya.de','Five Surveys':'fivesurveys.com',Flatmates:'flatmates.com.au',Fluz:'fluz.app',Folk:'folk.app',
  Foodora:'foodora.com',FortuneJack:'fortunejack.com',Found:'found.com','Free Fillable Forms':'freefilefillableforms.com',Freecash:'freecash.com',Freelancer:'freelancer.com',FreeNow:'free-now.com',Friended:'friended.com',Fruitz:'fruitz.io',
  G2A:'g2a.com',Gabi:'gabi.com',Gameflip:'gameflip.com',Gaydar:'gaydar.net',Gemini:'gemini.com',Getir:'getir.com',GetResponse:'getresponse.com',GETTR:'gettr.com','GIFTCARDS.com':'giftcards.com',GiftPocket:'giftpocket.com',Glovo:'glovoapp.com',
  GoDaddy:'godaddy.com',Goldbelly:'goldbelly.com',Gopuff:'gopuff.com',Grab:'grab.com',GrabPoints:'grabpoints.com',Grailed:'grailed.com',GrapeData:'grapedata.com',Grindr:'grindr.com',GroupMe:'groupme.com',Gumloop:'gumloop.com',
  'Handshake AI':'joinhandshake.com',Happn:'happn.com',HelloTalk:'hellotalk.com','Hey Cash':'heycash.com',HeyPiggy:'heypiggy.com',Hily:'hily.com',Hinge:'hinge.co',Hkticketing:'hkticketing.com',Homeguide:'homeguide.com',Hopper:'hopper.com',
  'House Sitter':'housesitter.com',hrblock:'hrblock.com','Humble Bundle':'humblebundle.com',HungryPanda:'hungrypanda.co',Hupu:'hupu.com','Idle-Empire':'idle-empire.com',Imo:'imo.im',Impact:'impact.com',Indeed:'indeed.com',InKind:'inkind.com',
  Innago:'innago.com','Insomnia Cookies':'insomniacookies.com',Instacart:'instacart.com',iPlum:'iplum.com','Ipsos iSay':'ipsosisay.com',Jackd:'jackd.com',JD:'jd.com',Jerry:'getjerry.com','Juno mail':'juno.com',Kaggle:'kaggle.com',KakaoTalk:'kakaocorp.com',
  Kalodata:'kalodata.com',Kalshi:'kalshi.com',KashKick:'kashkick.com',Kuaishou:'kuaishou.com',Laylo:'laylo.com','Lazada SG / PH':'lazada.sg','Leger Opinion':'legeropinion.com',LibertyX:'libertyx.com',Libon:'libon.com',Likee:'likee.video',Lime:'li.me',
  Linode:'linode.com','Live Nation':'livenation.com',LivU:'livu.me',LMK:'lmk.chat',LocalKitchens:'localkitchens.com',Locanto:'locanto.com',LOVOO:'lovoo.com',Lowes:'lowes.com',Luxy:'onluxy.com',ManusAI:'manus.im',Marblepay:'marblepay.com',
  'Match / Meetic / Zweisam':'match.com',Maza:'withmaza.com','Mercadolivre.com.br':'mercadolivre.com.br',Mercari:'mercari.com',Mercor:'mercor.com',Mistplay:'mistplay.com','Mode Earn App':'modeearnapp.com','Modo.us':'modo.us',MoneyPatrol:'moneypatrol.com',
  Moomoo:'moomoo.com',Mos:'mos.com',MyMusicTaste:'mymusictaste.com',Naver:'naver.com',Netease:'netease.com',Netzero:'netzero.net',Nextdoor:'nextdoor.com',NiceSurveys:'nicesurveys.com',Nielsen:'nielsen.com',Nike:'nike.com',NVIDIA:'nvidia.com',
  OfferUp:'offerup.com',OffGamers:'offgamers.com',OkCupid:'okcupid.com',OneForma:'oneforma.com',Oobit:'oobit.com',OpenPhone:'openphone.com',OpenTable:'opentable.com','Opinion Outpost':'opinionoutpost.com',Oportun:'oportun.com',OurTime:'ourtime.com',
  Outlier:'outlier.ai',OYO:'oyorooms.com',Parler:'parler.com','Patagonia / Rally':'patagonia.com','Pawns.app':'pawns.app','Pinecone Research':'pineconeresearch.com',PingMe:'pingme.tel','Pizza Hut':'pizzahut.com',PlayerAuctions:'playerauctions.com',
  'Plenty Of Fish / POF':'pof.com',Poe:'poe.com',Porkbun:'porkbun.com',POSH:'posh.vip',Poshamrk:'poshmark.com',Poshmark:'poshmark.com',PrankDial:'prankdial.com',Prezzee:'prezzee.com','Prime Opinion':'primeopinion.com',Prolific:'prolific.com',Propy:'propy.com',
  Public:'public.com','Public Surplus':'publicsurplus.com',Pulselabs:'pulselabs.ai',Punktid:'punktid.com','Quick Thoughts':'quickthoughtsapp.com',Raise:'raise.com',Razer:'razer.com',Rebtel:'rebtel.com','RedNote Xiaohongshu':'xiaohongshu.com',
  Resy:'resy.com',RetailMeNot:'retailmenot.com',Reverb:'reverb.com',Roomies:'roomies.com',Roomster:'roomster.com',RSVP:'rsvp.com.au',Rumble:'rumble.com','Sam’s Club':'samsclub.com','Screen Connect':'screenconnect.com',Seated:'seatedapp.io',SeatGeek:'seatgeek.com',
  Secretbenefits:'secretbenefits.com',Seeking:'seeking.com',Seniormatch:'seniormatch.com',Sephora:'sephora.com',Shaadi:'shaadi.com',SHEIN:'shein.com',Shopapp:'shop.app',ShopBack:'shopback.com',Shopkick:'shopkick.com',SilverSingles:'silversingles.com',
  Sinch:'sinch.com',Skout:'skout.com',SkyPrivate:'skyprivate.com',Sleeper:'sleeper.com',Smitten:'smittendating.com','Snap Kitchen':'snapkitchen.com',SodaGift:'sodagift.com','Soul App':'soulapp.cn','Spark Driver':'drive4spark.walmart.com',
  Spruce:'sprucehealth.com',Staples:'staples.com',Starbucks:'starbucks.com',SteemIt:'steemit.com',Stir:'stir.com',Strike:'strike.me',SugarDaddyMeet:'sugardaddymeet.com','Super.com':'super.com',Surveoo:'surveoo.com','Survey Pop':'surveypop.com',
  'Swagbucks / InboxDollars / InboxPounds / MyPoints / ySense / Adgate Survey / Tada / Poll Pay':'swagbucks.com',SweetRing:'sweetring.com',SwissBorg:'swissborg.com','Taco Bell':'tacobell.com',Taimi:'taimi.com','Tantan / 探探':'tantanapp.com',
  Temu:'temu.com','Tencent QQ':'qq.com',TextFree:'textfree.us',TheLeague:'theleague.com',Thervo:'thervo.com',Thumbtack:'thumbtack.com',Ticketmaster:'ticketmaster.com',Timeleft:'timeleft.com',Topper:'topperpay.com',TradeUp:'tradeup.com',TradingView:'tradingview.com',
  Trialfacts:'trialfacts.com',TrueCaller:'truecaller.com','Truth Social':'truthsocial.com',TurboTax:'turbotax.intuit.com',TurboTenant:'turbotenant.com',Turno:'turno.com',Turo:'turo.com',Twilio:'twilio.com',Ubisoft:'ubisoft.com',Underdog:'underdogfantasy.com',
  Upward:'upward-app.com',Upwork:'upwork.com','User Interviews':'userinterviews.com','Valued Opinions':'valuedopinions.com',Verasight:'verasight.ai',Vercel:'vercel.com',Viber:'viber.com','Victoria Milan':'victoriamilan.com',Vinted:'vinted.com',VMIX:'vmix.com',
  Vonage:'vonage.com',Walmart:'walmart.com',Waymo:'waymo.com',Webull:'webull.com',Weebly:'weebly.com','Weee!':'sayweee.com',Wert:'wert.io',Weward:'wewardapp.com',Whatnot:'whatnot.com',Whop:'whop.com',Wickr:'wickr.com',Wish:'wish.com',Wolt:'wolt.com',
  Wonder:'wonder.com',WooPlus:'wooplus.com',Xfinity:'xfinity.com',Yubo:'yubo.live',Zadarma:'zadarma.com',Zhihu:'zhihu.com',Zillow:'zillow.com',Zoho:'zoho.com',ZoomBucks:'zoombucks.com',Zoosk:'zoosk.com',
};
Object.assign(domains,{
  WhatsApp:'whatsapp.com',Telegram:'telegram.org','Google / Gmail / Youtube':'google.com','Google Business Profile':'business.google.com','Google Voice':'voice.google.com',
  'TikTok / Doujin':'tiktok.com','Facebook / Meta Viewpoints':'facebook.com','X.com / Twitter':'x.com',Snapchat:'snapchat.com',Discord:'discord.com',
  'Apple / Icloud':'apple.com','Amazon / AWS':'amazon.com','Microsoft / Outlook / Hotmail / Microsoft Rewards':'microsoft.com','Microsoft Azure':'azure.microsoft.com',
  'Instagram / Threads':'instagram.com','ChatGPT / OpenAI':'openai.com','Claude / Anthropic':'anthropic.com',Netflix:'netflix.com',Spotify:'spotify.com',Steam:'steampowered.com',
  Tinder:'tinder.com',LinkedIn:'linkedin.com',Yahoo:'yahoo.com',PayPal:'paypal.com','Cash App':'cash.app',Proton:'proton.me',
  ClutchPacks:'clutchpacks.com',Cerca:'cerca.dating',Catchback:'catchback.com','Chubby Club':'chubbyclub.com',Cobrand:'cobrand.com',Coupon24:'coupon24.com',Courtside:'courtside.com',
  EverywhereAgents:'everywhereagents.com','Fair Opinions':'fairopinions.com',Flip:'flip.shop',Freebuff:'freebuff.com',Gamut:'gamut.com',Grails:'grails.com',
  Helloaxel:'helloaxel.com',Hark:'hark.com',Hasaki:'hasaki.vn','Hyype Space':'hyypespace.com',IcyBox:'icybox.com','Improv Arena':'improvarena.com',
  'King Opinion':'kingopinion.com',Misprint:'misprint.com',Muse:'muse.com','My Health Surveys':'myhealthsurveys.com','Ninja miles':'ninjamiles.com',Novig:'novig.com',
  Onyx:'onyxapp.co',Packz:'packz.io','Paid Reader CLub':'paidreaderclub.com','Paid Tester':'paidtester.com',PaidViewPoints:'paidviewpoint.com',Phound:'phound.app',
  'Playful Rewards':'playfulrewards.com',Profhetx:'prophetx.co',Ratemate:'ratemate.com','Reward Hero':'rewardhero.com','Reward Rush':'rewardrush.app','Reward Time':'rewardtime.app',
  'Rhino Car Wash':'rhinocarwash.com',RIPHQ:'riphq.com','Rips By Triumph':'ripsbytriumph.com',SAJA:'saja.com',Sitch:'sitch.com',Snakzy:'snakzy.com',Spinpals:'spinpals.com',
  'Suds Car Wash':'sudscarwash.com','Survey / Top surveys':'topsurveys.app','Survey Streak':'surveystreak.com',SurveyHoney:'surveyhoney.com',Swittch:'swittch.com','Syno Panel':'synoint.com',
  'Table Talk':'tabletalk.com',Taskcent:'taskcent.com',Tiltrips:'tiltrips.com','True For Two':'truefortwo.com',Tuskcentral:'tuskcentral.com',US168:'us168.com','Win bonanza':'winbonanza.com','Wing Delivery':'wing.com',
  Benjamin:'benjaminone.com',Bumble:'bumble.com','Crypto.com':'crypto.com','Copper Survey':'coppersurveys.com','Earn star':'earnstar.com',
  'Share More Stories (seeq)':'sharemorestories.com',Cashcow:'cashcow.co',Sidecar:'sidecar.com',OG:'og.app',
});
const html=await (await fetch('https://getatext.com',{signal:AbortSignal.timeout(15000)})).text();
const names=[...new Set([...html.matchAll(/data-name="([^"]+)"/g)].map(m=>m[1].replaceAll('&amp;','&').replace(/&#(\d+);/g,(_,code)=>String.fromCodePoint(Number(code))).replaceAll('&quot;','"')))];
const existing=await readFile('apps/mobile/src/features/numbers/brand-artwork.ts','utf8');
const existingSlugs=new Set([...existing.matchAll(/^\s*"([^"]+)":/gm)].map(m=>m[1]));
const extra={};
for(const name of names) {
  const first=name.split(/\s*\/\s*/)[0];
  const match=Object.values(icons).find(i=>i&&typeof i==='object'&&i.slug&&(normalize(i.title)===normalize(first)||normalize(i.slug)===normalize(first)));
  if(match&&match.slug!=='red'&&!existingSlugs.has(match.slug)) extra[match.slug]={label:match.title,color:'#'+match.hex,path:match.path,source:match.source};
}
for(const slug of ['bitcoin','ethereum','tether','solana','litecoin','dogecoin','cardano','xrp','polygon','binance','bnbchain','ton','stellar','monero','polkadot','chainlink','uniswap','usdcoin','dai','tron']) {
  const match=Object.values(icons).find(i=>i?.slug===slug);
  if(match&&!existingSlugs.has(slug))extra[slug]={label:match.title,color:'#'+match.hex,path:match.path,source:match.source};
}
const target='apps/mobile/assets/service-brands';await mkdir(target,{recursive:true});
const prior=process.argv.includes('--complete')?JSON.parse(await readFile('apps/mobile/.expo/artwork-audit/results.json','utf8')):null;
const entries=prior?.entries??[], failures=[]; const done=new Set(entries.map(e=>e.source.replace('https://','')));
const tasks=process.argv.includes('--app-store')?[]:[...new Set(Object.entries(domains).map(([,d])=>d))].filter(d=>!done.has(d));
let next=0;
const hash=b=>createHash('sha256').update(b).digest('hex');
const generic=await fetch('https://www.google.com/s2/favicons?domain=invalid-billy-logo-test.invalid&sz=128').then(r=>r.arrayBuffer()).then(b=>hash(Buffer.from(b)));
async function worker(){while(next<tasks.length){const domain=tasks[next++];const aliases=Object.entries(domains).filter(([,d])=>d===domain).map(([n])=>n);
  try {
    // Confirm a primary brand source exists; do not send any customer information.
    let title='';let verified=false;
    try{
    const response=await fetch('https://'+domain,{signal:AbortSignal.timeout(6000),redirect:'follow'});
    if(!response.ok)throw new Error('Homepage unavailable');
    const page=(await response.text()).slice(0,1_000_000);
    if(/just a moment|access denied|verify you are human/i.test(page.slice(0,12000)))throw new Error('Homepage requires verification');
    title=page.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]??'';
    const officialDomain=domain.split('.').slice(-2,-1)[0];
    verified=normalize(title+' '+(page.match(/property=["']og:site_name["'][^>]*content=["']([^"']+)/i)?.[1]??'')).includes(normalize(officialDomain));
    if(!verified)throw new Error('Brand identity not confirmed');
    }catch(e){if(!process.argv.includes('--complete'))throw e;}
    const favicon=await fetch('https://www.google.com/s2/favicons?domain='+encodeURIComponent(domain)+'&sz=128',{signal:AbortSignal.timeout(8000)});
    const bytes=Buffer.from(await favicon.arrayBuffer());
    const extension=bytes.subarray(1,4).toString()==='PNG'?'png':bytes[0]===255&&bytes[1]===216?'jpg':null;
    if(!favicon.ok||bytes.length<100||bytes.length>300000||!extension||hash(bytes)===generic)throw new Error('No usable favicon');
    const slug=domain.replace(/[^a-z0-9]/g,'-');await writeFile(`${target}/${slug}.${extension}`,bytes);
    entries.push({slug,label:aliases[0],aliases,source:'https://'+domain,title:title.replace(/<[^>]+>/g,'').slice(0,180),verification:verified?'homepage-and-favicon':'official-domain-favicon',file:`../../../assets/service-brands/${slug}.${extension}`});
  }catch(e){failures.push({domain,aliases,reason:e.message});}
}}
await Promise.all(Array.from({length:12},worker));
if(process.argv.includes('--app-store')) {
  const load=(text,req)=>{const exported={};new Function('require','exports',ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(req,exported);return exported;};
  const fake={
    './brand-artwork':load(existing,()=>{}),'./generated-brand-artwork':{additionalArtwork:extra},
    './brand-rasters':{brandRasters:Object.fromEntries(entries.map(e=>[e.slug,{...e,asset:1}]))},
  };
  const registry=load(await readFile('apps/mobile/src/features/numbers/brand-registry.ts','utf8'),n=>fake[n]);
  const missing=names.filter(n=>!registry.serviceBrand(n)&&!/^Not Listed|^Red$|^OG$/.test(n));
  let appIndex=0;
  async function appWorker(){while(appIndex<missing.length){const name=missing[appIndex++];
    try{
      const term=name.split(/\s*\/\s*/)[0].replace(/\.com$/,'').replace(/\(.*\)/,'').trim();
      const normalized=normalize(term);
      const response=await fetch('https://itunes.apple.com/search?entity=software&country=us&limit=12&term='+encodeURIComponent(term),{signal:AbortSignal.timeout(12000)});
      if(!response.ok)throw new Error('App listing unavailable');const data=await response.json();
      const app=data.results?.find(a=>normalize(a.trackName??'')===normalized)??
        data.results?.find(a=>normalized.length>=5&&normalize(a.trackName??'').startsWith(normalized));
      if(!app?.artworkUrl512||!app.trackViewUrl)throw new Error('No exact app brand found');
      const image=await fetch(app.artworkUrl512,{signal:AbortSignal.timeout(12000)});const bytes=Buffer.from(await image.arrayBuffer());
      const ext=bytes.subarray(1,4).toString()==='PNG'?'png':bytes[0]===255&&bytes[1]===216?'jpg':null;
      if(!image.ok||!ext||bytes.length>500000)throw new Error('App artwork unavailable');
      const slug='app-'+app.trackId;await writeFile(`${target}/${slug}.${ext}`,bytes);
      const old=entries.find(e=>e.slug===slug);
      if(old)old.aliases.push(name);else entries.push({slug,label:name,aliases:[name],source:app.trackViewUrl,title:app.trackName,verification:'apple-app-listing',file:`../../../assets/service-brands/${slug}.${ext}`});
    }catch(e){failures.push({aliases:[name],reason:e.message});}
  }}
  await Promise.all(Array.from({length:3},appWorker));
}
// Primary listings verified separately for renamed brands; use their stable
// Apple IDs so a broad search cannot substitute another similarly named app.
for(const [id,aliases] of Object.entries({1638253339:['AHEALTH MoneyWalk'],741292507:['RedNote Xiaohongshu'],1673723000:['Duet']})) {
  if(entries.some(e=>e.slug==='app-'+id))continue;
  try {
    const data=await(await fetch('https://itunes.apple.com/lookup?country=us&id='+id,{signal:AbortSignal.timeout(12000)})).json();
    const app=data.results?.find(a=>String(a.trackId)===id);if(!app?.artworkUrl512)continue;
    const image=await fetch(app.artworkUrl512,{signal:AbortSignal.timeout(12000)});const bytes=Buffer.from(await image.arrayBuffer());
    const ext=bytes.subarray(1,4).toString()==='PNG'?'png':bytes[0]===255&&bytes[1]===216?'jpg':null;if(!image.ok||!ext||bytes.length>500000)continue;
    await writeFile(`${target}/app-${id}.${ext}`,bytes);
    entries.push({slug:'app-'+id,label:aliases[0],aliases,source:app.trackViewUrl,title:app.trackName,verification:'verified-renamed-app',file:`../../../assets/service-brands/app-${id}.${ext}`});
  }catch{/* Leave the existing local service symbol if a primary listing fails. */}
}
if(!entries.some(e=>e.slug==='clickatell-primary')) {
  try {
    const image=await fetch('https://www.clickatell.com/icons/icon-144x144.png',{signal:AbortSignal.timeout(10000)});
    const bytes=Buffer.from(await image.arrayBuffer());if(image.ok&&bytes.subarray(1,4).toString()==='PNG') {
      await writeFile(`${target}/clickatell-primary.png`,bytes);entries.push({slug:'clickatell-primary',label:'Clickatell',aliases:['Clickatell'],
        source:'https://www.clickatell.com',verification:'primary-site-icon',file:'../../../assets/service-brands/clickatell-primary.png'});
    }
  }catch{/* Preserve the local fallback. */}
}
entries.sort((a,b)=>a.slug.localeCompare(b.slug));
await mkdir('apps/mobile/.expo/artwork-audit',{recursive:true});
await writeFile('apps/mobile/.expo/artwork-audit/results.json',JSON.stringify({names,extra,entries,failures},null,2));
// Generated asset modules: static require paths let Metro package each image
// for Android/iOS/web. No third-party icon requests happen in the running app.
await writeFile('apps/mobile/src/features/numbers/generated-brand-artwork.ts',
  '// Generated by scripts/sync-service-artwork.mjs from simple-icons 16.35.0.\nexport const additionalArtwork = '+JSON.stringify(extra,null,2)+';\n');
await writeFile('apps/mobile/src/features/numbers/brand-rasters.ts',
  '// Generated by scripts/sync-service-artwork.mjs. Favicon artwork belongs to the named brands.\n'+
  'export const brandRasters: Record<string,{label:string;aliases:string[];asset:number;source:string}> = {\n'+
  entries.map(e=>JSON.stringify(e.slug)+':{label:'+JSON.stringify(e.label)+',aliases:'+JSON.stringify(e.aliases)+',asset:require('+JSON.stringify(e.file)+'),source:'+JSON.stringify(e.source)+'},').join('\n')+'\n};\n');
console.log(JSON.stringify({extraCount:Object.keys(extra).length,assetCount:entries.length,failures:failures.length,namesCount:names.length}));
