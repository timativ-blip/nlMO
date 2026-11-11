import {
  ArrowLeft,
  ExternalLink,
  FileText,
  Folder,
  Plus,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";
import {
  headquartersRpc,
  safeHttps,
  useHeadquarters,
  type Material,
} from "../data/headquarters";
import type { Route } from "../lib/router";
import { go } from "../lib/router";
import { useMe } from "../ui/hooks";
import { Button, Modal, toast } from "../ui/kit";
export default function MaterialsPage({ route }: { route: Route }) {
  const hq = useHeadquarters(),
    me = useMe(),
    parent = route.parts[1] || null,
    manager = ["head", "staff"].includes(me.role);
  const [edit, setEdit] = useState<Partial<Material> | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [search, setSearch] = useState("");
  const folder = hq.data?.materials.find((x) => x.id === parent),
    list = (hq.data?.materials ?? []).filter((m) =>
      search
        ? m.name
            .toLocaleLowerCase("ru")
            .includes(search.toLocaleLowerCase("ru"))
        : m.parent_id === parent,
    );
  const save = async () => {
    if (!edit) return;
    setBusy(true);
    setError("");
    try {
      if ((edit.name?.trim().length ?? 0) < 2)
        throw new Error("Название — от 2 до 160 символов.");
      if (
        (edit.url && !safeHttps(edit.url)) ||
        (edit.kind === "link" && !edit.url)
      )
        throw new Error("Добавьте ссылку, начинающуюся с https://.");
      await headquartersRpc("material_save", {
        ...edit,
        parentId: edit.parent_id ?? parent,
        requestId: crypto.randomUUID(),
      });
      setEdit(null);
      hq.refresh();
      toast("Материал сохранён.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>Материалы</h1>
          <p className="sub">Документы, шаблоны и общие папки штаба.</p>
        </div>
        {manager && (
          <Button
            variant="primary"
            icon={Plus}
            onClick={() => {
              setError("");
              setEdit({
                kind: "folder",
                name: "",
                url: "",
                description: "",
                parent_id: parent,
              });
            }}
          >
            Добавить
          </Button>
        )}
      </div>
      {hq.error && (
        <p className="callout danger" role="alert">
          {hq.error}
          <Button size="sm" icon={RefreshCw} onClick={hq.refresh}>
            Повторить
          </Button>
        </p>
      )}
      <div className="row wrap hq-toolbar">
        {parent && (
          <Button
            icon={ArrowLeft}
            onClick={() => {
              setSearch("");
              go(
                "/materials" +
                  (folder?.parent_id ? "/" + folder.parent_id : ""),
              );
            }}
          >
            Назад
          </Button>
        )}
        <h2 className="grow">{folder?.name ?? "Все материалы"}</h2>
        <input
          className="input"
          style={{ maxWidth: 300 }}
          aria-label="Найти материал"
          placeholder="Найти материал"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {folder?.url && (
        <div className="material-drive card">
          <Folder size={28} />
          <div className="grow">
            <h2>{folder.name}</h2>
            <p className="muted">
              Файлы открываются на Google Диске с вашими правами доступа.
            </p>
          </div>
          <a
            className="btn btn-primary"
            href={safeHttps(folder.url)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Открыть папку <ExternalLink size={16} />
          </a>
        </div>
      )}
      {hq.loading && <p role="status">Загружаю материалы…</p>}
      <div className="materials-grid">
        {list.map((m) => (
          <article className="card material-card" key={m.id}>
            <span className="resource-icon">
              {m.kind === "folder" ? (
                <Folder size={25} />
              ) : (
                <FileText size={25} />
              )}
            </span>
            <h2>{m.name}</h2>
            <p className="muted grow">{m.description}</p>
            <div className="row wrap">
              {m.kind === "folder" ? (
                <Button
                  onClick={() => {
                    setSearch("");
                    go("/materials/" + m.id);
                  }}
                >
                  Открыть
                </Button>
              ) : (
                <a
                  className="btn btn-primary"
                  href={safeHttps(m.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Открыть <ExternalLink size={15} />
                </a>
              )}
              {manager && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setError("");
                    setEdit(m);
                  }}
                >
                  Изменить
                </Button>
              )}
            </div>
          </article>
        ))}
      </div>
      {!hq.loading && !list.length && (
        <p className="muted">
          {search
            ? "По этому запросу ничего не найдено."
            : folder?.url
              ? "Вложенные файлы доступны по кнопке «Открыть папку». Здесь штаб может закрепить отдельные ссылки."
              : "Пока нет материалов. Штаб может добавить папку или ссылку."}
        </p>
      )}
      <Modal
        open={!!edit}
        title="Материал или папка"
        onClose={() => {
          if (!busy) setEdit(null);
        }}
        footer={
          <>
            <Button disabled={busy} onClick={() => setEdit(null)}>
              Закрыть
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => void save()}
            >
              {busy ? "Сохраняю…" : "Сохранить"}
            </Button>
          </>
        }
      >
        {edit && (
          <div className="col" style={{ gap: 14 }}>
            <label className="field">
              Тип
              <select
                className="input"
                aria-label="Тип материала"
                value={edit.kind}
                onChange={(e) =>
                  setEdit({ ...edit, kind: e.target.value as Material["kind"] })
                }
              >
                <option value="folder">Папка</option>
                <option value="link">Ссылка на материал</option>
              </select>
            </label>
            <label className="field">
              Название
              <input
                className="input"
                maxLength={160}
                value={edit.name ?? ""}
                onChange={(e) => setEdit({ ...edit, name: e.target.value })}
              />
            </label>
            <label className="field">
              Ссылка {edit.kind === "folder" ? "(необязательно)" : ""}
              <input
                className="input"
                type="url"
                maxLength={2000}
                value={edit.url ?? ""}
                onChange={(e) => setEdit({ ...edit, url: e.target.value })}
                placeholder="https://…"
              />
            </label>
            <label className="field">
              Описание
              <textarea
                className="input"
                maxLength={2000}
                aria-label="Описание"
                value={edit.description ?? ""}
                onChange={(e) =>
                  setEdit({ ...edit, description: e.target.value })
                }
              />
            </label>
            {edit.id && (
              <label className="row">
                <input
                  type="checkbox"
                  checked={!!edit.archived}
                  onChange={(e) =>
                    setEdit({ ...edit, archived: e.target.checked })
                  }
                />
                Убрать из каталога
              </label>
            )}
            {error && (
              <p className="callout danger" role="alert">
                {error}
              </p>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
