import { CloudOff, RefreshCw, LogOut } from 'lucide-react';
import { reconnectReports, signOut, useAppState } from '../data/store';
import { DailyReportForm } from './Daily';
import { WeeklyReportEditor } from '../ui/WeeklyReportEditor';
import { ReportDeliveryStatus } from '../ui/ReportDelivery';
import { ThemeToggle } from '../ui/appearance';
import { Button } from '../ui/kit';
import { fmtRange, addDays } from '../lib/date';
export default function OfflineReports(){
 const s=useAppState();const me=s.users.find(u=>u.id===s.session.userId)!;
 return <main className="offline-report-center content"><header className="page-head"><div className="grow"><h1>Отчёты без связи</h1><p className="sub">{me.name} · копия для заполнения на этом устройстве</p></div><ThemeToggle/><Button icon={RefreshCw} onClick={()=>void reconnectReports()}>Проверить соединение</Button><Button variant="ghost" icon={LogOut} onClick={()=>void signOut()}>Выйти</Button></header>
  <div className="callout warn"><CloudOff size={20}/><span>Рабочие данные сейчас недоступны. Можно заполнить отчёты и сохранить их в очередь. Статус «сдан» появится после подтверждения сервера. Права и актуальная версия проверятся при подключении.</span></div>
  <ReportDeliveryStatus always/>
  <DailyReportForm/>
  {s.reports.filter(r=>['draft','returned'].includes(r.status)).map(r=><section className="card card-pad col" style={{gap:14}} key={r.id}><h2>Недельный отчёт · {s.districts.find(d=>d.id===r.districtId)?.name}</h2><span className="small muted">{fmtRange(r.weekStart,addDays(r.weekStart,6))} · показатели будут доступны после подключения</span><WeeklyReportEditor report={r}/></section>)}
 </main>;
}
