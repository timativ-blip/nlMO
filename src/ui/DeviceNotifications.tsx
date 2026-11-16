import { BellRing, CheckCircle2, Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DEMO_MODE, useAppState } from '../data/store';
import { currentPush, disablePush, enablePush, needsHomeScreen, pushAvailable, pushRequest } from '../lib/push';
import { Button, toast } from './kit';
export function DeviceNotifications(){
 const s=useAppState();const [enabled,setEnabled]=useState(false),[publicKey,setPublicKey]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const supported=pushAvailable(),homeScreen=needsHomeScreen();
 useEffect(()=>{let alive=true;
  if(DEMO_MODE||!supported){setLoading(false);return;}
  Promise.all([currentPush(s.session.userId),pushRequest('status')]).then(([sub,status])=>{if(alive){setEnabled(!!sub);setPublicKey(status.publicKey??'');}}).catch(()=>{if(alive)setError('Не удалось проверить подключение. Обновите страницу или попробуйте позже.');}).finally(()=>{if(alive)setLoading(false);});
  return()=>{alive=false;};
 },[supported,s.session.userId]);
 const action=async(fn:()=>Promise<void>,message:string)=>{setBusy(true);setError('');try{await fn();setEnabled(!!await currentPush(s.session.userId));toast(message);}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 return <section className="card card-pad col device-notifications" style={{gap:14}}>
  <h2 className="row"><Smartphone size={19}/>Уведомления на устройстве</h2>
  <p className="small muted">Задачи, встречи, сообщения и напоминания об отчётах — от сайта и установленного приложения, даже когда страница закрыта. Telegram продолжает работать отдельно.</p>
  {homeScreen&&<div className="callout small">На iPhone или iPad добавьте сайт на главный экран через меню «Поделиться», затем откройте его с иконки и включите уведомления здесь.</div>}
  {DEMO_MODE?<p className="small muted">Подключение доступно после входа в рабочий аккаунт.</p>:!supported?<p className="small muted">В этом браузере push пока недоступен. Уведомления остаются в колокольчике и подключённом Telegram.</p>:<>
   <span className={`row small ${enabled?'':'muted'}`}>{enabled?<CheckCircle2 size={16}/>:<BellRing size={16}/>} {loading?'Проверяем подключение…':enabled?'Включены на этом устройстве':'Пока не включены'}</span>
   {!loading&&!publicKey&&!error&&<p className="small muted">Подключение уведомлений готовится. Попробуйте позже.</p>}
   <div className="row wrap">{enabled?<><Button disabled={busy} onClick={()=>action(async()=>{const sub=await currentPush(s.session.userId);if(!sub)throw new Error('Включите уведомления заново.');await pushRequest('test',{endpoint:sub.endpoint});},'Проверочное уведомление отправлено')}>Проверить уведомление</Button><Button disabled={busy} onClick={()=>action(disablePush,'Уведомления на этом устройстве выключены')}>Выключить</Button></>:<Button variant="primary" icon={BellRing} disabled={busy||loading||!publicKey} onClick={()=>action(()=>enablePush(publicKey,s.ui.notify,s.session.userId),'Уведомления подключены')}>{busy?'Подключаем…':'Включить на этом устройстве'}</Button>}</div>
  </>}
  {error&&<p className="danger-text small" role="alert">{error}</p>}
  <p className="small muted">Подключите каждое устройство отдельно. Система может задержать уведомление в режиме фокусирования или без сети.</p>
 </section>;
}
