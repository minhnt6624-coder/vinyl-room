import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

const DESKTOP = '(min-width: 768px)';

function useIsDesktop() {
  const [is, setIs] = useState(() => window.matchMedia(DESKTOP).matches);
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP);
    const on = () => setIs(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return is;
}

interface Props {
  open: boolean;
  onClose(): void;
  title: string;
  eyebrow?: string;
  children: ReactNode;
}

/** A side panel on desktop and tablet, a bottom sheet on phones. */
export function Sheet({ open, onClose, title, eyebrow, children }: Props) {
  const desktop = useIsDesktop();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const hidden = desktop ? { x: '100%' } : { y: '100%' };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          <motion.div
            className="absolute inset-0 bg-ink/30"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.section
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={hidden}
            animate={{ x: 0, y: 0 }}
            exit={hidden}
            transition={{ type: 'tween', duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}
            className="absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col rounded-t-3xl bg-paper shadow-float md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[440px] md:rounded-none"
          >
            <div className="mx-auto mt-2.5 h-1 w-10 flex-none rounded-full bg-ink/20 md:hidden" aria-hidden="true" />
            <header className="flex flex-none items-start justify-between gap-4 px-5 pb-3 pt-4 md:px-7 md:pt-7">
              <div className="min-w-0">
                {eyebrow && <div className="eyebrow mb-1 text-indigo">{eyebrow}</div>}
                <h2 className="truncate font-display text-3xl font-semibold leading-tight">{title}</h2>
              </div>
              <button className="icon-btn -mr-2" onClick={onClose} aria-label="Close" autoFocus>
                <X size={20} />
              </button>
            </header>
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:px-7">
              {children}
            </div>
          </motion.section>
        </div>
      )}
    </AnimatePresence>
  );
}
