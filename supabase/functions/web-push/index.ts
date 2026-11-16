import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import * as webpush from 'npm:web-push@4.0.0';
import { createPushHandler } from './handler.ts';
import { pushPayload, validateSubscription, type Subscription } from './core.ts';
const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
async function secret(key:string){const {data,error}=await admin.from('app_secrets').select('value').eq('key',key).maybeSingle();if(error)throw error;return data?.value??'';}
type Vapid={publicKey:string;privateKey:string;until:number};
let vapid:Vapid|undefined,loadingVapid:Promise<Vapid>|undefined;
async function vapidKeys(){
 if(vapid&&vapid.until>Date.now())return vapid;
 loadingVapid??=Promise.all([secret('web_push_public_key'),secret('web_push_private_key')]).then(([publicKey,privateKey])=>vapid={publicKey,privateKey,until:Date.now()+60000}).finally(()=>{loadingVapid=undefined;});
 return loadingVapid;
}
async function send(subscription:Subscription, payload:unknown){
 const {publicKey,privateKey}=await vapidKeys();
 if(!publicKey||!privateKey)throw new Error('Push is not configured');
 const details=webpush.generateRequestDetails(validateSubscription(subscription),JSON.stringify(payload),{vapidDetails:{subject:'https://timativ-blip.github.io/nlMO/',publicKey,privateKey},TTL:3600,urgency:'normal',contentEncoding:'aes128gcm'});
 const r=await fetch(details.endpoint,{method:'POST',headers:Object.fromEntries(Object.entries(details.headers).map(([k,v])=>[k,String(v)])),body:details.body,redirect:'error',signal:AbortSignal.timeout(10000)});
 await r.body?.cancel();return r.status;
}
Deno.serve(createPushHandler({
 authorize:async token=>{const {data:{user},error}=await admin.auth.getUser(token);if(error||!user)return null;const {data}=await admin.from('profiles').select('data').eq('id',user.id).maybeSingle();const p=data?.data;return p&&p.active!==false&&!p.pending&&['head','staff','coordinator'].includes(p.role)?user.id:null;},
 publicKey:()=>secret('web_push_public_key'),hookSecret:()=>secret('hook_secret'),
 subscribe:async(userId,subscription,muted)=>{
  const {error}=await admin.from('push_subscriptions').upsert({endpoint:subscription.endpoint,user_id:userId,subscription,muted,updated_at:new Date().toISOString()},{onConflict:'endpoint'});if(error)throw error;
 },
 unsubscribe:async(userId,endpoint)=>{const {error}=await admin.from('push_subscriptions').delete().eq('user_id',userId).eq('endpoint',endpoint);if(error)throw error;},
 test:async(userId,endpoint)=>{
  const {data}=await admin.from('push_subscriptions').select('subscription').eq('user_id',userId).eq('endpoint',endpoint).maybeSingle();if(!data)throw new Error('No subscription');
  const status=await send(data.subscription,{id:'test-'+Date.now(),kind:'report',title:'Уведомления подключены',body:'Задачи, встречи и напоминания об отчётах будут приходить на это устройство.',link:'#/settings'});
  if(status<200||status>=300)throw new Error('Push rejected');
 },
 dispatch:async()=>{
  const {data:jobs,error}=await admin.rpc('claim_push_deliveries');if(error)throw error;
  let sent=0,retry=0,removed=0,skipped=0;
  await Promise.all((jobs??[]).map(async(job:{notification_id:string;subscription_id:string;subscription:Subscription;notification:{id:string;kind:string;text:string;link:string};attempts:number;enabled:boolean})=>{
   let status=0;try {status=job.enabled?await send(job.subscription,pushPayload(job.notification)):204;}catch{/* Retry transient failures without logging device capabilities. */}
   if(status===404||status===410){await admin.from('push_subscriptions').delete().eq('id',job.subscription_id);removed++;return;}
   const done=status>=200&&status<300||status===400||status===401||status===403||job.attempts>=5;
   const {error}=await admin.from('push_deliveries').update({state:done?'done':'pending',available_at:new Date(Date.now()+Math.min(3600,60*2**job.attempts)*1000).toISOString(),locked_until:null,last_status:status}).eq('notification_id',job.notification_id).eq('subscription_id',job.subscription_id).eq('attempts',job.attempts).eq('state','working');
   if(error)throw error;if(!done)retry++;else if(job.enabled&&status>=200&&status<300)sent++;else skipped++;
  }));
  return {processed:jobs?.length??0,sent,retry,removed,skipped};
 }
}));
