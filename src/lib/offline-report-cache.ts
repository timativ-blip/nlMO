import type { State, User } from '../data/types';
import { addDays, todayISO, weekStart } from './date';
import { readOfflineSnapshot, reportOwner, saveOfflineSnapshot, type OfflineSnapshot } from './report-queue';
const marker=(scope:string)=>`kc-offline-report-user:${scope}`;
export function clearOfflineReportAccess(scope:string){try{localStorage.removeItem(marker(scope));}catch{}}
export function persistedSessionUser(scope:string){try{const raw=localStorage.getItem(scope);if(!raw||raw.length>100000)return '';const user=JSON.parse(raw)?.user;return typeof user?.id==='string'?user.id:'';}catch{return '';}}
export async function cacheReportWorkspace(scope:string,state:State,stillCurrent:()=>boolean=()=>true){
 const me=state.users.find(u=>u.id===state.session.userId);
 if(!me||!me.active||me.pending||!['head','staff','coordinator'].includes(me.role)){clearOfflineReportAccess(scope);return;}
 const user:User={...me,email:'',phone:'',photo:undefined,telegram:undefined,birthday:undefined,birthdayVisibility:'hidden'};
 const reports=state.reports.filter(r=>(me.role==='head'||me.role==='coordinator'&&r.districtId===me.districtId)&&['draft','returned'].includes(r.status)&&r.weekStart>=addDays(weekStart(todayISO()),-7)).map(r=>({...r,history:[]}));
 const snapshot:OfflineSnapshot={owner:reportOwner(scope,me.id),user,reports,dailyReports:state.dailyReports.filter(r=>r.userId===me.id&&r.day>=addDays(todayISO(),-2)),districts:state.districts.filter(d=>reports.some(r=>r.districtId===d.id)||d.id===me.districtId).map(d=>({id:d.id,name:d.name,num:d.num,coordinatorId:null})),verifiedAt:Date.now()};
 await saveOfflineSnapshot(snapshot);
 try{if(stillCurrent())localStorage.setItem(marker(scope),me.id);}catch{/* Reports in the queue still persist independently. */}
}
export async function cachedReportWorkspace(scope:string,userId:string){
 try{if(localStorage.getItem(marker(scope))!==userId)return null;}catch{return null;}
 const snapshot=await readOfflineSnapshot(reportOwner(scope,userId));
 return snapshot&&snapshot.user.id===userId&&snapshot.user.active&&!snapshot.user.pending&&['head','staff','coordinator'].includes(snapshot.user.role)?snapshot:null;
}
