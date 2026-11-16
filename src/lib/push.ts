import { sb, BACKEND } from './supabase';
import type { UiPrefs } from '../data/types';
const DEVICE_KEY='kc-push-device-v1';
let deviceOwner='';
function ownsDevice(userId:string){try{deviceOwner=localStorage.getItem(DEVICE_KEY)||deviceOwner;}catch{}return deviceOwner===userId;}
export function pushAvailable(){return typeof window!=='undefined'&&window.isSecureContext&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;}
export function needsHomeScreen(){return /iPhone|iPad|iPod/.test(navigator.userAgent)&&!window.matchMedia('(display-mode: standalone)').matches&&!(navigator as Navigator&{standalone?:boolean}).standalone;}
export async function pushRequest(action:string,body:Record<string,unknown>={}){
 if(!sb)throw new Error('Уведомления подключаются в рабочем кабинете.');
 const {data,error}=await sb.functions.invoke('web-push',{body:{action,...body}});
 if(error||data?.error)throw new Error(data?.error??'Не удалось связаться с уведомлениями. Повторите позже.');
 return data as {ready?:boolean;publicKey?:string;ok?:boolean};
}
async function registration(){
 let r=await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
 if(!r)r=await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
 return Promise.race([navigator.serviceWorker.ready,new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('Приложение ещё обновляется. Перезагрузите страницу и повторите.')),12000))]);
}
const muted=(prefs:UiPrefs['notify'])=>Object.entries(prefs).filter(([,on])=>on===false).map(([key])=>key);
export async function currentPush(userId?:string){if(!pushAvailable()||userId&&!ownsDevice(userId))return null;return (await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL))?.pushManager.getSubscription()??null;}
export async function enablePush(publicKey:string,prefs:UiPrefs['notify'],userId:string){
 // Request permission directly from the click, before any network awaits (Safari requirement).
 const permission=await Notification.requestPermission();
 if(permission!=='granted')throw new Error(permission==='denied'?'Разрешите уведомления для этого сайта в настройках браузера.':'Разрешение пока не выдано. Можно включить позже.');
 const bytes=Uint8Array.from(atob(publicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
 const r=await registration();const existing=await r.pushManager.getSubscription();
 const subscription=existing??await r.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});
 try {await pushRequest('subscribe',{subscription:subscription.toJSON(),muted:muted(prefs)});}
 catch(e){if(!existing)await subscription.unsubscribe();throw e;}
 deviceOwner=userId;
 try{localStorage.setItem(DEVICE_KEY,userId);}catch{/* Optional device flag. */}
 window.dispatchEvent(new Event('push-device-changed'));
}
export async function syncPushPreferences(prefs:UiPrefs['notify'],userId:string){
 const s=await currentPush(userId);if(s&&BACKEND)await pushRequest('subscribe',{subscription:s.toJSON(),muted:muted(prefs)});
}
export async function disablePush(){
 const s=await currentPush();
 try{if(s&&BACKEND)await pushRequest('unsubscribe',{endpoint:s.endpoint});}
 finally{if(s)await s.unsubscribe();deviceOwner='';try{localStorage.removeItem(DEVICE_KEY);}catch{}window.dispatchEvent(new Event('push-device-changed'));}
}
