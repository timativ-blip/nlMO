import { Check, Download, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, toast } from './kit';

/** The finished state follows actual file generation, without a simulated percentage. */
export function DownloadButton({ onDownload, children, disabled, icon = Download }: { onDownload: () => void | Promise<void>; children: ReactNode; disabled?: boolean; icon?: LucideIcon }) {
  const [phase, setPhase] = useState<'idle' | 'working' | 'done'>('idle');
  const mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; clearTimeout(timer.current); }; }, []);
  const download = async () => {
    clearTimeout(timer.current);
    setPhase('working');
    try {
      await onDownload();
      if (!mounted.current) return;
      setPhase('done');
      timer.current = setTimeout(() => setPhase('idle'), 2400);
    } catch (error) {
      if (mounted.current) setPhase('idle');
      toast(error instanceof Error ? error.message : 'Не удалось подготовить файл. Попробуйте ещё раз.', 'error');
    }
  };
  return <Button icon={phase === 'done' ? Check : icon} disabled={disabled || phase === 'working'} aria-busy={phase === 'working'} onClick={download} className={`download-button download-${phase}`}>
    <span aria-live="polite">{phase === 'working' ? 'Готовим файл…' : phase === 'done' ? 'Файл готов' : children}</span>
    {phase === 'working' && <span className="download-activity" aria-hidden />}
  </Button>;
}
