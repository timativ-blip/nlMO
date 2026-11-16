import { Bell, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { DEMO_MODE, useAppState } from '../data/store';
import type { Notification } from '../data/types';
import { syncPushPreferences } from '../lib/push';
import { useMe } from './hooks';
export function NotificationDelivery(){
 const s=useAppState(),me=useMe();const seen=useRef<{user:string;ids:Set<string>}|null>(null),[incoming,setIncoming]=useState<Notification|null>(null);
 useEffect(()=>{
  const own=s.notifications.filter(n=>n.userId===me.id);
  if(seen.current?.user!==me.id){seen.current={user:me.id,ids:new Set(own.map(n=>n.id))};setIncoming(null);return;}
  const fresh=own.filter(n=>!seen.current!.ids.has(n.id)&&!n.read&&s.ui.notify[n.kind]!==false);
  own.forEach(n=>seen.current!.ids.add(n.id));
  const last=fresh[0];if(!last||document.visibilityState!=='visible')return;
  setIncoming(last);
 },[s.notifications,s.ui.notify,me.id]);
 useEffect(()=>{if(!incoming)return;const timer=setTimeout(()=>setIncoming(null),10000);return()=>clearTimeout(timer);},[incoming]);
 useEffect(()=>{if(DEMO_MODE)return;const timer=setTimeout(()=>{syncPushPreferences(s.ui.notify,me.id).catch(()=>{/* Inbox preferences still apply; sync retries on focus. */});},700);return()=>clearTimeout(timer);},[s.ui.notify,me.id]);
 useEffect(()=>{const sync=()=>{if(document.visibilityState==='visible'&&!DEMO_MODE)void syncPushPreferences(s.ui.notify,me.id).catch(()=>{});};document.addEventListener('visibilitychange',sync);return()=>document.removeEventListener('visibilitychange',sync);},[s.ui.notify,me.id]);
 if(!incoming)return null;
 return <aside className="notification-banner" role="status" aria-live="polite"><Bell size={20}/><button className="notification-banner-open" onClick={()=>{if(/^#\/[a-z]/.test(incoming.link))location.hash=incoming.link;setIncoming(null);}}><b>Новое уведомление</b><span>{incoming.text}</span></button><button className="icon-btn" aria-label="Закрыть уведомление" onClick={()=>setIncoming(null)}><X size={17}/></button></aside>;
}
