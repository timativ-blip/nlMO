import { mutedKinds, sameSecret, validateSubscription, type Subscription } from './core.ts';
interface Dependencies {
  authorize: (token: string) => Promise<string | null>;
  publicKey: () => Promise<string>;
  hookSecret: () => Promise<string>;
  subscribe: (userId: string, subscription: Subscription, muted: string[]) => Promise<void>;
  unsubscribe: (userId: string, endpoint: string) => Promise<void>;
  test: (userId: string, endpoint: string) => Promise<void>;
  dispatch: () => Promise<unknown>;
}
export function createPushHandler(deps: Dependencies) {
  return async (req: Request) => {
    const origin=req.headers.get('origin');
    const headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'};
    if(origin==='https://timativ-blip.github.io')headers['Access-Control-Allow-Origin']=origin;
    const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
    if(origin&&origin!=='https://timativ-blip.github.io')return json({error:'Нет доступа с этого адреса.'},403);
    if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(req.method!=='POST')return json({error:'Метод не поддерживается.'},405);
    try {
      const raw=await req.text();if(raw.length>8000)return json({error:'Слишком большой запрос.'},413);
      const body=JSON.parse(raw);
      if(body.action==='dispatch'){
        if(!sameSecret(req.headers.get('x-hook-secret')??'',await deps.hookSecret()))return json({error:'Нет доступа.'},403);
        return json(await deps.dispatch());
      }
      const token=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'')??'';
      const uid=token?await deps.authorize(token):null;
      if(!uid)return json({error:'Войдите в рабочий кабинет.'},401);
      if(body.action==='status'){const key=await deps.publicKey();return json({ready:!!key,publicKey:key});}
      if(body.action==='subscribe'){
        let subscription, muted;
        try { subscription=validateSubscription(body.subscription);muted=mutedKinds(body.muted??[]); }
        catch(e){return json({error:(e as Error).message},400);}
        await deps.subscribe(uid,subscription,muted);return json({enabled:true});
      }
      if(body.action==='unsubscribe'||body.action==='test'){
        if(typeof body.endpoint!=='string'||body.endpoint.length>2048)return json({error:'Некорректное устройство.'},400);
        if(body.action==='unsubscribe')await deps.unsubscribe(uid,body.endpoint);else await deps.test(uid,body.endpoint);
        return json({ok:true});
      }
      return json({error:'Неизвестное действие.'},400);
    }catch(e){return json({error:e instanceof SyntaxError?'Некорректный запрос.':'Не удалось подтвердить действие. Повторите позже.'},502);}
  };
}
