// Demo media stays local, using the same fictional people as the rest of the demo.
import { addDays, todayISO } from '../lib/date';
import type { State } from './types';
import type { GroupsData, PdData, Post } from '../pages/Media';

export function demoMedia(name: string, state: State): PdData | GroupsData | null {
  const today = todayISO();
  if (name === 'media-pd') {
    const people: [string,string][] = state.users.filter((u) => u.active).map((u) => [u.name,u.districtId ?? 'hq']);
    const posts: Post[] = [];
    people.forEach(([person],i) => {
      if (i%5 === 0) return;
      for (let day = 0; day < 84; day++) {
        if ((day*7+i*13)%11 > 2) continue;
        const views = 35+(i*73+day*19)%1400, counted = views >= 50 ? 1 : 0;
        posts.push([addDays(today,-day),`Демо · ${['Работа команды округа','Встреча с жителями','Результаты недели','Ответы на обращения'][day%4]}`,person,day%3 ? 'vk':'tg',i,Math.round(views/20),1,views,Math.round(views*.06),day%7,day%5,0,'',counted,counted ? '':'Меньше 50 просмотров']);
      }
    });
    return { groups: [...state.districts.map((d)=>({id:d.id,num:d.num??0,name:d.name})),{id:'hq',num:0,name:'Штаб'}],people,posts,updated:new Date().toISOString() };
  }
  if (name === 'media-groups') return { groups: state.districts.flatMap((d,i)=>(d.cities?.slice(0,2)??[d.name]).map((city,j)=>({
    okrug:d.id,city,coord:state.users.find((u)=>u.id===d.coordinatorId)?.name??'Демо-координатор',resp:'Демо-команда',
    vk:{status:'ok' as const,last:`${addDays(today,-(i+j)%7)}T10:00:00+03:00`,about:'Демонстрационный пост о работе округа'},
    tg:{status:'ok' as const,last:`${addDays(today,-(i*2+j)%8)}T12:00:00+03:00`,about:'Демонстрационный анонс встречи'},
  }))),vkEnabled:true,updated:new Date().toISOString() };
  return null;
}
