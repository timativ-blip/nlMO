import { Banknote, Download, FileText, Plus, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { amountMinor, budgetAction, downloadReceipt, exportBudget, loadBudget, receiptUploadPath, rubles, uploadReceipt, type Advance, type Expense, type BudgetFund, type FundingRequest } from "../data/budget";
import { DEMO_MODE } from "../data/store";
import { fmtDate, todayISO } from "../lib/date";
import { useLookup, useMe } from "../ui/hooks";
import { Button, Empty, Modal, toast } from "../ui/kit";
import { go, useRoute } from "../lib/router";
import { MetricValue } from "../ui/metricSources";
import type { SourceRecord } from "../ui/global";

const statuses = { pending: "На проверке", accepted: "Принят", returned: "На доработке" };
type Edit =
  | { kind: "fund_save"; id: string; previous?: BudgetFund; scope: BudgetFund["kind"]; name: string; district: string; responsible: string; limit: string }
  | { kind: "request"; id: string; fund: BudgetFund; amount: string; purpose: string }
  | { kind: "mark_sent" | "reject"; request: FundingRequest; date: string; note: string }
  | { kind: "issue"; id: string; fund: BudgetFund; recipient: string; amount: string; date: string; purpose: string }
  | { kind: "submit"; id: string; advance: Advance; old?: Expense; amount: string; date: string; description: string; receipt?: File; upload?: ReturnType<typeof receiptUploadPath> }
  | { kind: "review"; expense: Expense; decision: "accepted" | "returned"; note: string };

export default function BudgetPage() {
  const me = useMe();
  return <BudgetWorkspace key={me.id} />;
}

function BudgetWorkspace() {
  const me = useMe();
  const lookup = useLookup();
  const route = useRoute();
  const reviewer = me.role === "head";
  const [data, setData] = useState<Awaited<ReturnType<typeof loadBudget>>>();
  const [loadingError, setLoadingError] = useState("");
  const [revision, setRevision] = useState(0);
  const [fundId, setFundId] = useState("");
  const [advanceId, setAdvanceId] = useState("");
  const [edit, setEdit] = useState<Edit | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [outputBusy, setOutputBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const attempt = useRef<{ key: string; id: string }>();
  const file = useRef<HTMLInputElement>(null);
  const targetFund = route.query.get('fund') ?? '';
  const targetAdvance = route.query.get('advance') ?? '';
  const targetExpense = route.query.get('expense') ?? '';
  useEffect(() => {
    setFundId(targetFund);
    setAdvanceId(targetAdvance);
    setSelected([]);
  }, [targetFund, targetAdvance]);

  useEffect(() => {
    let active = true;
    void loadBudget().then((next) => {
      if (active) {
        setData(next);
        setLoadingError("");
      }
    }, (error: Error) => {
      if (active) setLoadingError(error.message);
    });
    return () => { active = false; };
  }, [revision]);

  const fund = data?.funds.find((item) => item.id === fundId) ?? data?.funds[0];
  const advances = data?.advances.filter((item) => item.fund_id === fund?.id) ?? [];
  const requests = data?.requests.filter((item) => item.fund_id === fund?.id) ?? [];
  const advance = advances.find((item) => item.id === advanceId) ?? advances[0];
  const expenses = data?.expenses.filter((item) => item.advance_id === advance?.id) ?? [];
  const accepted = expenses.filter((item) => item.status === "accepted");
  const pendingAmount = expenses.reduce((sum, row) => sum + (row.status === "pending" ? row.amount_minor : 0), 0);
  const acceptedAmount = accepted.reduce((sum, row) => sum + row.amount_minor, 0);
  const budgetPath = (fundId: string, advanceId?: string, expenseId?: string) => '/budget?' + new URLSearchParams({
    fund: fundId, ...(advanceId ? { advance: advanceId } : {}), ...(expenseId ? { expense: expenseId } : {}),
  });
  const advanceRecord = (row: Advance): SourceRecord => ({
    id: row.id, title: row.purpose, detail: `${fmtDate(row.issued_on)} · ${lookup.user(row.recipient_id)?.name ?? 'Сотрудник'}`,
    value: rubles(row.amount_minor), href: budgetPath(row.fund_id,row.id),
  });
  const expenseRecord = (row: Expense): SourceRecord => ({
    id: row.id, title: row.description, detail: `${fmtDate(row.spent_on)} · ${statuses[row.status]}`,
    value: rubles(row.amount_minor), href: budgetPath(fund!.id,row.advance_id,row.id),
  });
  const fundRecord = (row: BudgetFund): SourceRecord => ({
    id: row.id, title: row.name, detail: 'Установленный лимит', value: rubles(row.limit_minor), href: budgetPath(row.id),
  });
  const fundIssues = advances.map(advanceRecord);
  const restrictedIssued = (fund?.issued_minor ?? 0) - advances.reduce((sum, row) => sum + row.amount_minor, 0);
  if (restrictedIssued > 0) fundIssues.push({
    id:'restricted', title:'Выдачи вне вашей зоны доступа', value:rubles(restrictedIssued),
    detail:'Входят в общую сумму. Детали доступны руководству.',
  });
  useEffect(() => {
    if (targetExpense && expenses.some(row => row.id === targetExpense)) {
      const frame = requestAnimationFrame(() => document.getElementById('budget-expense-' + targetExpense)?.scrollIntoView({block:'center'}));
      return () => cancelAnimationFrame(frame);
    }
  }, [data, advance?.id, targetExpense]);
  const recipients = [...lookup.users.values()]
    .filter((user) => user.active && !user.pending && user.role !== "member")
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const canUse = (budget: BudgetFund, user: typeof me) => user.role === "head"
    || (budget.kind === "district" && user.role === "coordinator" && user.districtId === budget.district_id)
    || (budget.kind === "media" && user.title === "media")
    || (budget.kind === "direction" && user.id === budget.responsible_id);
  const openFund = (previous?: BudgetFund) => {
    setMessage("");
    setEdit({
      kind: "fund_save", id: previous?.id ?? crypto.randomUUID(), previous, scope: previous?.kind ?? "direction",
      name: previous?.name ?? "", district: previous?.district_id ?? "", responsible: previous?.responsible_id ?? "",
      limit: previous ? (previous.limit_minor / 100).toFixed(2).replace(".", ",") : "",
    });
  };
  const refresh = () => setRevision((value) => value + 1);
  const editExpense = (target: Advance, old?: Expense) => {
    setMessage("");
    setEdit({
      kind: "submit", id: old?.id ?? crypto.randomUUID(), advance: target, old,
      amount: old ? (old.amount_minor / 100).toFixed(2).replace(".", ",") : "",
      date: old?.spent_on ?? todayISO(), description: old?.description ?? "",
    });
  };

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!edit || busy) return;
    setBusy(true);
    setMessage("");
    try {
      let body: Record<string, unknown>;
      if (edit.kind === "fund_save") {
        const name = edit.name.trim() || (edit.scope === "district" && edit.district ? lookup.dname(edit.district) : edit.scope === "media" ? "Медиа" : "");
        if (name.length < 2) throw new Error("Укажите название бюджета.");
        body = { id: edit.id, version: edit.previous?.version, kind: edit.scope, name,
          districtId: edit.district || null, responsibleId: edit.responsible || null, limitMinor: amountMinor(edit.limit, true) };
      } else if (edit.kind === "request") {
        if (edit.purpose.trim().length < 3) throw new Error("Укажите назначение средств.");
        body = { id: edit.id, fundId: edit.fund.id, amountMinor: amountMinor(edit.amount), purpose: edit.purpose };
      } else if (edit.kind === "mark_sent" || edit.kind === "reject") {
        if (edit.kind === "reject" && edit.note.trim().length < 3) throw new Error("Укажите причину отказа.");
        body = { id: edit.request.id, date: edit.date, note: edit.note };
      } else if (edit.kind === "issue") {
        if (!edit.recipient || edit.purpose.trim().length < 3) throw new Error("Укажите получателя и назначение выдачи.");
        body = { id: edit.id, fundId: edit.fund.id, recipientId: edit.recipient, amountMinor: amountMinor(edit.amount), date: edit.date, purpose: edit.purpose };
      } else if (edit.kind === "submit") {
        const minor = amountMinor(edit.amount);
        if (edit.description.trim().length < 3 || !edit.date) throw new Error("Укажите дату и описание расхода.");
        let receiptPath = edit.old?.receipt_path;
        let receiptName = edit.old?.receipt_name;
        if (edit.receipt && edit.upload) {
          await uploadReceipt(edit.receipt, edit.upload);
          receiptPath = edit.upload.path;
          receiptName = edit.receipt.name.slice(0, 180);
        }
        if (!receiptPath) throw new Error("Прикрепите фото чека или PDF.");
        body = {
          id: edit.id, advanceId: edit.advance.id, version: edit.old?.version, amountMinor: minor,
          date: edit.date, description: edit.description, receiptPath, receiptName,
        };
      } else if (edit.kind === "review") {
        if (edit.decision === "returned" && edit.note.trim().length < 3) throw new Error("Напишите, что нужно исправить.");
        body = { id: edit.expense.id, version: edit.expense.version, status: edit.decision, note: edit.note };
      } else return;
      const key = JSON.stringify([edit.kind, body]);
      if (attempt.current?.key !== key) attempt.current = { key, id: crypto.randomUUID() };
      await budgetAction(edit.kind, { ...body, requestId: attempt.current.id });
      if (edit.kind === "issue") { setAdvanceId(edit.id); go(budgetPath(edit.fund.id, edit.id)); }
      if (edit.kind === "mark_sent") { setAdvanceId(edit.request.id); go(budgetPath(edit.request.fund_id, edit.request.id)); }
      if (edit.kind === "fund_save") { setFundId(edit.id); setAdvanceId(""); go(budgetPath(edit.id)); }
      setEdit(null);
      refresh();
      toast("Изменения сохранены");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function download(work: () => Promise<void>) {
    setOutputBusy(true);
    try {
      await work();
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setOutputBusy(false);
    }
  }

  return <>
    <div className="page-head">
      <div className="grow">
        <h1>Бюджет</h1>
        <p className="sub">Округа, медиа и направления · заявки, выдачи и чеки</p>
      </div>
      {!DEMO_MODE && <Button icon={RefreshCw} onClick={refresh}>Обновить</Button>}
      {!DEMO_MODE && reviewer && <Button variant="primary" icon={Plus} onClick={() => openFund()}>Добавить направление</Button>}
    </div>
    {data && ((targetFund && fund?.id !== targetFund) || (targetAdvance && advance?.id !== targetAdvance) || (targetExpense && !expenses.some(item => item.id === targetExpense))) &&
      <div className="callout info">Запись по ссылке не найдена или вам недоступна. Ниже — доступный вам бюджет.</div>}
    {loadingError ? <div className="callout danger" role="alert">{loadingError} <Button size="sm" icon={RefreshCw} onClick={refresh}>Повторить</Button></div>
      : !data ? <p role="status">Загружаю бюджет…</p>
      : !fund ? <div className="card"><Empty icon={Banknote} title={DEMO_MODE ? "Бюджет доступен в рабочем кабинете" : "Бюджетов пока нет"} text={DEMO_MODE ? undefined : "Руководство может задать суммы для округов и направлений."} /></div>
      : <div className="col budget-workspace">
        <section className="card card-pad col">
          <div className="row wrap">
            <label className="field grow">Бюджет
              <select className="select" value={fund.id} onChange={(event) => {
                go(budgetPath(event.target.value)); setFundId(event.target.value); setAdvanceId(""); setSelected([]);
              }}>
                {data.funds.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
          </div>
          <dl className="budget-totals">
            <div><dt>Выделено</dt><dd><MetricValue records={{title:'Лимит бюджета',items:[fundRecord(fund)]}}>{rubles(fund.limit_minor)}</MetricValue></dd></div>
            <div><dt>Отправлено</dt><dd><MetricValue records={{title:'Отправленные суммы',rule:'Сумма фактических выдач бюджета.',items:fundIssues}}>{rubles(fund.issued_minor)}</MetricValue></dd></div>
            <div><dt>Осталось к выдаче</dt><dd><MetricValue records={{title:'Доступно к выдаче',rule:'Лимит бюджета за вычетом отправленных сумм.',sections:[{title:'Лимит',items:[fundRecord(fund)]},{title:'Выдачи',items:fundIssues}]}}>{rubles(fund.limit_minor - fund.issued_minor)}</MetricValue></dd></div>
          </dl>
          <div className="row wrap">
            {canUse(fund, me) && <Button variant="primary" icon={Plus} onClick={() => {
              setMessage(""); setEdit({ kind: "request", id: crypto.randomUUID(), fund, amount: "", purpose: "" });
            }}>Запросить средства</Button>}
            {reviewer && <>
              <Button onClick={() => openFund(fund)}>Изменить бюджет</Button>
              <Button onClick={() => {
                setMessage(""); setEdit({ kind: "issue", fund, id: crypto.randomUUID(), recipient: "", date: todayISO(), amount: "", purpose: "" });
              }}>Записать выдачу</Button>
            </>}
          </div>
        </section>
        <section className="card card-pad col">
          <h2>Заявки</h2>
          {!requests.length && <p className="muted">Заявок по этому бюджету пока нет.</p>}
          {requests.map((request) => <article className="budget-expense" key={request.id}>
            <div className="grow budget-expense-copy">
              <b>{request.purpose}</b>
              <p className="small muted">{lookup.user(request.recipient_id)?.name ?? "Сотрудник"} · {rubles(request.amount_minor)} · {fmtDate(request.created_at)}</p>
              {request.decision_note && <p className="small">{request.decision_note}</p>}
            </div>
            <div className="row wrap">
              <span className={`badge ${request.status === "sent" ? "st-done" : request.status === "rejected" ? "st-overdue" : "st-review"}`}>
                {{ pending: "Ожидает отправки", sent: "Деньги отправлены", rejected: "Отклонена" }[request.status]}
              </span>
              {reviewer && request.status === "pending" && <>
                <Button size="sm" variant="primary" onClick={() => {
                  setMessage(""); setEdit({ kind: "mark_sent", request, date: todayISO(), note: "" });
                }}>Отметить отправку</Button>
                <Button size="sm" onClick={() => {
                  setMessage(""); setEdit({ kind: "reject", request, date: todayISO(), note: "" });
                }}>Отклонить</Button>
              </>}
              {request.status === "sent" && request.recipient_id === me.id && <Button size="sm" onClick={() => {
                const payment = advances.find((item) => item.request_id === request.id);
                if (payment) { setAdvanceId(payment.id); editExpense(payment); }
              }}>Добавить чек</Button>}
            </div>
          </article>)}
        </section>
        {!advance ? <section className="card card-pad"><h2>Выдачи и чеки</h2><p className="muted">Выдачи появятся после отметки об отправке денег.</p></section> : <>
        <section className="card card-pad col">
          <label className="field">
            Выдача
            <select className="select" value={advance.id} onChange={(event) => {
              go(budgetPath(fund.id,event.target.value));
              setAdvanceId(event.target.value);
              setSelected([]);
            }}>
              {advances.map((item) => <option key={item.id} value={item.id}>
                {fmtDate(item.issued_on)} · {item.purpose}{reviewer ? " · " + (lookup.user(item.recipient_id)?.name ?? "Сотрудник") : ""}
              </option>)}
            </select>
          </label>
          <dl className="budget-totals">
            <div><dt>Выдано</dt><dd><MetricValue records={{title:'Выдача',items:[advanceRecord(advance)]}}>{rubles(advance.amount_minor)}</MetricValue></dd></div>
            <div><dt>Принято</dt><dd><MetricValue records={{title:'Принятые расходы и чеки',items:accepted.map(expenseRecord)}}>{rubles(acceptedAmount)}</MetricValue></dd></div>
            <div><dt>На проверке</dt><dd><MetricValue records={{title:'Расходы на проверке',items:expenses.filter(row=>row.status==='pending').map(expenseRecord)}}>{rubles(pendingAmount)}</MetricValue></dd></div>
            <div><dt>{acceptedAmount > advance.amount_minor ? "Перерасход" : "Остаток по принятым чекам"}</dt>
              <dd><MetricValue records={{title:'Остаток по выдаче',rule:'Выданная сумма минус принятые расходы; отрицательный остаток — перерасход.',sections:[{title:'Выдача',items:[advanceRecord(advance)]},{title:'Принятые расходы',items:accepted.map(expenseRecord)}]}}>{rubles(Math.abs(advance.amount_minor - acceptedAmount))}</MetricValue></dd></div>
          </dl>
        </section>
        <section className="card card-pad col">
          <div className="row wrap">
            <h2 className="grow">Расходы</h2>
            {advance.recipient_id === me.id && <Button variant="primary" icon={Plus} onClick={() => editExpense(advance)}>Добавить расход</Button>}
            {reviewer && accepted.length > 0 && <Button icon={Download} disabled={outputBusy || !accepted.some((item) => selected.includes(item.id))}
              onClick={() => void download(() => exportBudget(fund, advance, accepted.filter((item) => selected.includes(item.id)),
                lookup.user(advance.recipient_id)?.name ?? "", lookup.dname(advance.district_id)))}>
              {outputBusy ? "Подготовка…" : "Архив для 1С"}
            </Button>}
          </div>
          {reviewer && accepted.length > 0 && <label className="row small">
            <input type="checkbox" checked={accepted.every((item) => selected.includes(item.id))}
              onChange={(e) => setSelected(e.target.checked ? accepted.map((item) => item.id) : [])} />
            Выбрать все принятые расходы для выгрузки
          </label>}
          {!expenses.length && <Empty icon={FileText} title="Чеков пока нет" />}
          {expenses.map((expense) => <article key={expense.id} id={'budget-expense-' + expense.id} className={`budget-expense ${expense.id === targetExpense ? 'metric-selected' : ''}`}>
            {reviewer && expense.status === "accepted" && <input type="checkbox" aria-label={`Выбрать расход «${expense.description}»`}
              checked={selected.includes(expense.id)} onChange={(event) => setSelected((items) =>
                event.target.checked ? [...items, expense.id] : items.filter((id) => id !== expense.id))} />}
            <div className="grow budget-expense-copy">
              <b>{expense.description}</b>
              <p className="small muted">{fmtDate(expense.spent_on)} · {rubles(expense.amount_minor)}</p>
              {expense.review_note && <p className="small">{expense.review_note}</p>}
            </div>
            <div className="row wrap">
              <span className={`badge ${expense.status === "accepted" ? "st-done" : expense.status === "returned" ? "st-overdue" : "st-review"}`}>{statuses[expense.status]}</span>
              <Button size="sm" icon={Download} disabled={outputBusy} onClick={() => void download(() => downloadReceipt(expense))}>Чек</Button>
              {expense.status === "returned" && advance.recipient_id === me.id && <Button size="sm" onClick={() => editExpense(advance, expense)}>Исправить</Button>}
              {reviewer && expense.status === "pending" && <Button size="sm" variant="primary" onClick={() => {
                setMessage("");
                setEdit({ kind: "review", expense, decision: "accepted", note: "" });
              }}>Проверить</Button>}
            </div>
          </article>)}
        </section>
        </>}
      </div>}

    <Modal open={!!edit} onClose={() => { if (!busy) setEdit(null); }}
      title={edit ? ({
        fund_save: "Настройка бюджета", request: "Запросить средства", mark_sent: "Отметка об отправке",
        reject: "Отклонить заявку", issue: "Записать выдачу", review: "Решение по расходу", submit: "Расход и чек",
      })[edit.kind] : ""}>
      {edit && <form className="col budget-form" onSubmit={(event) => void save(event)}>
        {edit.kind === "fund_save" && <>
          {edit.scope !== "direction" && <p>{edit.scope === "media" ? "Медиа" : lookup.dname(edit.district)}</p>}
          {edit.scope === "direction" && <label className="field">Ответственный
            <select required className="select" value={edit.responsible} onChange={(event) => setEdit({ ...edit, responsible: event.target.value })}>
              <option value="">Выберите сотрудника</option>
              {recipients.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
            </select>
          </label>}
          <label className="field">Название <input required={edit.scope === "direction"} className="input" maxLength={160}
            value={edit.name} onChange={(event) => setEdit({ ...edit, name: event.target.value })} /></label>
          <label className="field">Выделено, ₽ <input required className="input" inputMode="decimal" maxLength={18}
            value={edit.limit} onChange={(event) => setEdit({ ...edit, limit: event.target.value })} /></label>
        </>}
        {edit.kind === "request" && <>
          <p>{edit.fund.name} · к выдаче {rubles(edit.fund.limit_minor - edit.fund.issued_minor)}</p>
          <label className="field">Сумма, ₽ <input required className="input" inputMode="decimal" maxLength={16}
            value={edit.amount} onChange={(event) => setEdit({ ...edit, amount: event.target.value })} /></label>
          <label className="field">На что нужны средства <textarea required className="textarea" maxLength={300}
            value={edit.purpose} onChange={(event) => setEdit({ ...edit, purpose: event.target.value })} /></label>
        </>}
        {(edit.kind === "mark_sent" || edit.kind === "reject") && <>
          <p>{lookup.user(edit.request.recipient_id)?.name} · {rubles(edit.request.amount_minor)} · {edit.request.purpose}</p>
          {edit.kind === "mark_sent" && <label className="field">Когда отправили деньги
            <input required className="input" type="date" max={todayISO()} value={edit.date} onChange={(event) => setEdit({ ...edit, date: event.target.value })} />
          </label>}
          <label className="field">{edit.kind === "reject" ? "Причина отказа" : "Комментарий"}
            <textarea required={edit.kind === "reject"} className="textarea" maxLength={1000} value={edit.note}
              onChange={(event) => setEdit({ ...edit, note: event.target.value })} />
          </label>
        </>}
        {edit.kind === "issue" && <>
          <label className="field">Получатель
            <select required className="select" value={edit.recipient} onChange={(event) => setEdit({ ...edit, recipient: event.target.value })}>
              <option value="">Выберите сотрудника</option>
              {recipients.filter((user) => canUse(edit.fund, user)).map((user) => <option key={user.id} value={user.id}>{user.name} · {lookup.dname(user.districtId)}</option>)}
            </select>
          </label>
          <label className="field">Назначение <input required className="input" maxLength={300} value={edit.purpose} onChange={(event) => setEdit({ ...edit, purpose: event.target.value })} /></label>
        </>}
        {(edit.kind === "issue" || edit.kind === "submit") && <div className="grid g-2">
          <label className="field">Сумма, ₽ <input required className="input" maxLength={16} inputMode="decimal" value={edit.amount} onChange={(event) => setEdit({ ...edit, amount: event.target.value })} /></label>
          <label className="field">Дата <input required className="input" type="date" max={todayISO()} value={edit.date} onChange={(event) => setEdit({ ...edit, date: event.target.value })} /></label>
        </div>}
        {edit.kind === "submit" && <>
          <label className="field">На что потратили <textarea required className="textarea" maxLength={1000} rows={3} value={edit.description} onChange={(event) => setEdit({ ...edit, description: event.target.value })} /></label>
          <label className="field">{edit.old ? "Заменить чек" : "Прикрепить чек"}
            <input ref={file} type="file" accept=".jpg,.jpeg,.png,.webp,.heic,.heif,.pdf" onChange={(event) => {
              setMessage("");
              const receipt = event.target.files?.[0];
              try {
                setEdit({ ...edit, receipt, upload: receipt ? receiptUploadPath(me.id, edit.id, receipt) : undefined });
              } catch (error) {
                if (file.current) file.current.value = "";
                setEdit({ ...edit, receipt: undefined, upload: undefined });
                setMessage((error as Error).message);
              }
            }} />
          </label>
          {edit.old && !edit.receipt && <p className="small muted">Прикреплён {edit.old.receipt_name}</p>}
        </>}
        {edit.kind === "review" && <>
          <p>{edit.expense.description} · {rubles(edit.expense.amount_minor)}</p>
          <Button type="button" icon={Download} disabled={outputBusy} onClick={() => {
            const expense = edit.expense;
            void download(() => downloadReceipt(expense));
          }}>Скачать чек</Button>
          <label className="field">Решение
            <select className="select" value={edit.decision} onChange={(event) => setEdit({ ...edit, decision: event.target.value as "accepted" | "returned" })}>
              <option value="accepted">Принять</option><option value="returned">Вернуть на доработку</option>
            </select>
          </label>
          <label className="field">Комментарий <textarea className="textarea" rows={3} maxLength={1000} required={edit.decision === "returned"} value={edit.note} onChange={(event) => setEdit({ ...edit, note: event.target.value })} /></label>
        </>}
        {message && <p className="callout danger" role="alert">{message}</p>}
        <div className="row wrap">
          <Button type="button" disabled={busy} onClick={() => setEdit(null)}>Отмена</Button>
          <Button type="submit" variant="primary" disabled={busy}>{busy ? "Сохраняю…" : edit.kind === "submit" ? "Отправить на проверку" : edit.kind === "request" ? "Отправить заявку" : "Сохранить"}</Button>
        </div>
      </form>}
    </Modal>
  </>;
}
