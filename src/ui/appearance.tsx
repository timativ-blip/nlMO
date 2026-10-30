import { Monitor, Moon, Sun } from 'lucide-react';
import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark' | 'system';
const KEY = 'kc-appearance-v1';
const media = window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set<() => void>();
const readTheme = (): Theme => {
  try { const value = localStorage.getItem(KEY); return value === 'light' || value === 'dark' ? value : 'system'; }
  catch { return 'system'; }
};
let theme = readTheme();
let resolved: 'light' | 'dark' = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;

function apply() {
  resolved = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#101416' : '#f3f6f5');
  listeners.forEach((fn) => fn());
}
media.addEventListener('change', apply);
window.addEventListener('storage', (event) => { if (event.key === KEY || event.key === null) { theme = readTheme(); apply(); } });
apply();

export function setTheme(next: Theme) {
  theme = next;
  try { localStorage.setItem(KEY, next); } catch { /* The theme still works when storage is unavailable. */ }
  apply();
}
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export function useTheme() {
  const value = useSyncExternalStore(subscribe, () => `${theme}:${resolved}`);
  const [preference, current] = value.split(':') as [Theme, 'light' | 'dark'];
  return { theme: preference, resolved: current, setTheme };
}

export function ThemeToggle() {
  const { resolved: current } = useTheme();
  const Icon = current === 'dark' ? Moon : Sun;
  return <button className="theme-toggle" type="button" onClick={() => setTheme(current === 'dark' ? 'light' : 'dark')}
    aria-label={current === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'} title={current === 'dark' ? 'Светлая тема' : 'Тёмная тема'}>
    <Icon size={18} aria-hidden />
  </button>;
}

export function AppearanceSettings() {
  const { theme: current } = useTheme();
  return <section className="card card-pad appearance-settings">
    <div><h2>Оформление</h2><p className="small muted">Тема сохраняется на этом устройстве.</p></div>
    <div className="theme-options" role="group" aria-label="Цветовая тема">
      {([{ id: 'light', label: 'Светлая', icon: Sun }, { id: 'dark', label: 'Тёмная', icon: Moon }, { id: 'system', label: 'Как на устройстве', icon: Monitor }] as const).map(({ id, label, icon: Icon }) =>
        <button type="button" key={id} className={`theme-option ${current === id ? 'selected' : ''}`} aria-pressed={current === id} onClick={() => setTheme(id)}>
          <span className={`theme-preview preview-${id}`} aria-hidden><i /><i /><i /></span><span><Icon size={15} />{label}</span>
        </button>)}
    </div>
  </section>;
}
