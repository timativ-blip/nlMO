import { ChevronDown, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";

export interface NavigationItem {
  id: string;
  label: string;
  icon: LucideIcon;
}
const GROUPS = [
  { id: "work", label: "Работа", pages: ["tasks", "calendar", "team"] },
  {
    id: "control",
    label: "Контроль",
    pages: ["performance", "pulse", "analytics", "reports", "daily", "media"],
  },
  { id: "meetings", label: "Встречи", pages: ["meetings", "planning"] },
  {
    id: "hq",
    label: "Штаб",
    pages: ["materials", "headquarters", "equipment"],
  },
];
const KEY = "kc-nav-groups-v1";
function initialGroups() {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (Array.isArray(saved))
      return saved.filter(
        (id): id is string =>
          typeof id === "string" && GROUPS.some((g) => g.id === id),
      );
  } catch {
    /* optional preference */
  }
  return ["work"];
}
export function WorkspaceNavigation({
  items,
  page,
  collapsed,
  dailyMissing,
  taskCount,
}: {
  items: NavigationItem[];
  page: string;
  collapsed: boolean;
  dailyMissing: boolean;
  taskCount: number;
}) {
  const [open, setOpen] = useState(initialGroups);
  const activeGroup = GROUPS.find((g) => g.pages.includes(page))?.id;
  useEffect(() => {
    if (activeGroup)
      setOpen((value) =>
        value.includes(activeGroup) ? value : [...value, activeGroup],
      );
  }, [activeGroup, page]);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(open));
    } catch {
      /* navigation stays usable */
    }
  }, [open]);
  const link = (item: NavigationItem) => (
    <a
      key={item.id}
      href={`#/${item.id}`}
      className={`nav-item ${page === item.id ? "active" : ""}`}
      aria-current={page === item.id ? "page" : undefined}
      aria-label={item.label}
      title={collapsed ? item.label : undefined}
    >
      <item.icon size={19} strokeWidth={1.8} />
      <span className="nav-label">{item.label}</span>
      {item.id === "daily" && dailyMissing && (
        <span className="count" title="Отчёт за сегодня ещё не сдан">
          1
        </span>
      )}
      {item.id === "tasks" && taskCount > 0 && (
        <span className="count" title="Результаты на проверке и ваши просрочки">
          {taskCount}
        </span>
      )}
    </a>
  );
  return (
    <div className="sidebar-links">
      {items.filter((item) => item.id === "home").map(link)}
      {GROUPS.map((group) => {
        const entries = group.pages.flatMap((id) =>
          items.filter((item) => item.id === id),
        );
        if (!entries.length) return null;
        const expanded = open.includes(group.id);
        const count =
          group.id === "work"
            ? taskCount
            : group.id === "control" && dailyMissing
              ? 1
              : 0;
        return (
          <section
            key={group.id}
            className="nav-group"
            aria-label={group.label}
          >
            {!collapsed && (
              <button
                type="button"
                className={`nav-group-heading ${activeGroup === group.id ? "current-section" : ""}`}
                aria-label={group.label}
                aria-expanded={expanded}
                aria-controls={"nav-group-" + group.id}
                onClick={() =>
                  setOpen((value) =>
                    value.includes(group.id)
                      ? value.filter((id) => id !== group.id)
                      : [...value, group.id],
                  )
                }
              >
                <span className="grow">{group.label}</span>
                {!expanded && count > 0 && (
                  <span className="nav-group-count" aria-hidden>
                    {count}
                  </span>
                )}
                <ChevronDown
                  size={14}
                  aria-hidden
                  className={expanded ? "is-open" : ""}
                />
              </button>
            )}
            <div
              id={"nav-group-" + group.id}
              className="nav-group-items"
              hidden={!collapsed && !expanded}
            >
              {entries.map(link)}
            </div>
          </section>
        );
      })}
    </div>
  );
}
export function NavigationSectionsMenu({
  items,
  onPick,
}: {
  items: NavigationItem[];
  onPick: (id: string) => void;
}) {
  return (
    <>
      {GROUPS.map((group) => {
        const entries = group.pages.flatMap((id) =>
          items.filter(
            (item) =>
              item.id === id && !["tasks", "calendar", "team"].includes(id),
          ),
        );
        return entries.length > 0 ? (
          <section className="mobile-nav-group" key={group.id}>
            <h3>{group.label}</h3>
            {entries.map((item) => (
              <button
                type="button"
                key={item.id}
                className="menu-item"
                onClick={() => onPick(item.id)}
              >
                <item.icon size={19} />
                {item.label}
              </button>
            ))}
          </section>
        ) : null;
      })}
    </>
  );
}
