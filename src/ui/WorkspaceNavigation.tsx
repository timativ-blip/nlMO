import { Building2, ChevronDown, MapPin, Megaphone, Search, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";

export interface NavigationItem { id: string; label: string; icon: LucideIcon }

// Shared by desktop navigation, contextual links and the mobile menu.
// Existing URLs also remain valid for notifications and saved links.
const GROUPS = [
  { id: "work", label: "Работа", pages: ["tasks", "calendar"] },
  { id: "meetings", label: "Планёрки", pages: ["planning", "meetings"] },
  { id: "districts", label: "Округа", icon: MapPin, pages: ["team", "performance", "pulse", "analytics", "reports", "daily"] },
  { id: "content", label: "Контент", icon: Megaphone, pages: ["media"] },
  { id: "hq", label: "Штаб", icon: Building2, pages: ["headquarters", "equipment", "budget"] },
];
const KEY = "kc-nav-groups-v2";
const PRIMARY = ["home", "tasks", "planning", "materials"];
export const workspaceSection = (page: string) => GROUPS.find(g => g.pages.includes(page));

function initialGroups() {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (Array.isArray(saved)) return saved.filter((id): id is string => typeof id === "string" && GROUPS.some(g => g.id === id));
  } catch { /* optional preference */ }
  return [];
}

export function WorkspaceNavigation({ items, page, collapsed, dailyMissing, taskCount, onSearch }: {
  items: NavigationItem[]; page: string; collapsed: boolean; dailyMissing: boolean; taskCount: number; onSearch: () => void;
}) {
  const [open, setOpen] = useState(initialGroups);
  const activeGroup = workspaceSection(page)?.id;
  useEffect(() => {
    if (activeGroup) setOpen(value => value.includes(activeGroup) ? value : [...value, activeGroup]);
  }, [activeGroup, page]);
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(open)); } catch { /* navigation stays usable */ }
  }, [open]);
  const link = (item: NavigationItem, primary = false, groupId?: string) => {
    const selected = page === item.id || primary && (
      item.id === "tasks" && activeGroup === "work" || item.id === "planning" && activeGroup === "meetings"
    ) || !!groupId && activeGroup === groupId;
    return <a key={item.id} href={`#/${item.id}`} className={`nav-item ${selected ? "active" : ""}`}
      aria-current={page === item.id ? "page" : undefined} aria-label={item.label} title={collapsed ? item.label : undefined}>
      <item.icon size={18} strokeWidth={1.7}/><span className="nav-label">{item.label}</span>
      {(item.id === "daily" || groupId === "districts") && dailyMissing && <span className="count" title="Отчёт за сегодня ещё не сдан">1</span>}
      {item.id === "tasks" && taskCount > 0 && <span className="count" title="Результаты на проверке и ваши просрочки">{taskCount}</span>}
    </a>;
  };
  return <>
    <button type="button" className="sidebar-search" onClick={onSearch} aria-label="Поиск по людям, задачам и округам" title={collapsed ? "Поиск" : undefined}>
      <Search size={17}/><span className="nav-label grow">Поиск</span><kbd className="nav-label">⌘ K</kbd>
    </button>
    <nav className="sidebar-links" aria-label="Разделы штаба">
      {PRIMARY.flatMap(id => items.filter(item => item.id === id)).map(item => link(item, true))}
      <div className="sidebar-section-rule"/>
      {GROUPS.filter(g => "icon" in g).map(group => {
        const entries = group.pages.flatMap(id => items.filter(item => item.id === id));
        if (!entries.length) return null;
        if (group.id === "content") return <div key={group.id} className="nav-direct">{link({ ...entries[0], label: "Контент" })}</div>;
        if (collapsed) return <div key={group.id} className="nav-direct">{link({ ...entries[0], label: group.label, icon: group.icon! }, false, group.id)}</div>;
        const expanded = open.includes(group.id);
        const Icon = group.icon!;
        return <section key={group.id} className="nav-group" aria-label={group.label}>
          <button type="button" className={`nav-group-heading ${activeGroup === group.id ? "current-section" : ""}`}
            aria-label={group.label} aria-expanded={expanded} aria-controls={"nav-group-" + group.id}
            onClick={() => setOpen(value => value.includes(group.id) ? value.filter(id => id !== group.id) : [...value, group.id])}>
            <Icon size={18} strokeWidth={1.7}/><span className="grow">{group.label}</span>
            {!expanded && group.id === "districts" && dailyMissing && <span className="nav-group-count" aria-hidden>1</span>}
            <ChevronDown size={14} aria-hidden className={`group-chevron ${expanded ? "is-open" : ""}`}/>
          </button>
          <div id={"nav-group-" + group.id} className="nav-group-items" hidden={!expanded}>{entries.map(item => link(item))}</div>
        </section>;
      })}
    </nav>
  </>;
}

export function WorkspaceSections({ items, page }: { items: NavigationItem[]; page: string }) {
  const group = workspaceSection(page);
  if (!group || group.pages.length < 2) return null;
  const links = group.pages.flatMap(id => items.filter(item => item.id === id));
  if (links.length < 2) return null;
  return <nav className="workspace-sections" aria-label={`Разделы: ${group.label}`}>
    {links.map(item => <a href={`#/${item.id}`} key={item.id} className={page === item.id ? "active" : ""} aria-current={page === item.id ? "page" : undefined}>
      <item.icon size={15}/><span>{item.label}</span>
    </a>)}
  </nav>;
}

export function NavigationSectionsMenu({ items, onPick }: { items: NavigationItem[]; onPick: (id: string) => void }) {
  return <>
    <section className="mobile-nav-group"><h3>Материалы</h3>{items.filter(item => item.id === "materials").map(item => <button type="button" key={item.id} className="menu-item" onClick={() => onPick(item.id)}><item.icon size={19}/>{item.label}</button>)}</section>
    {GROUPS.map(group => {
      const entries = group.pages.flatMap(id => items.filter(item => item.id === id && !["tasks", "calendar", "team"].includes(id)));
      return entries.length > 0 ? <section className="mobile-nav-group" key={group.id}><h3>{group.label}</h3>
        {entries.map(item => <button type="button" key={item.id} className="menu-item" onClick={() => onPick(item.id)}><item.icon size={19}/>{item.label}</button>)}
      </section> : null;
    })}
  </>;
}
