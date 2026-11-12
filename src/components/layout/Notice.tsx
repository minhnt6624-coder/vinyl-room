import { LoaderCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { Backdrop } from './Backdrop';
import { Logo } from './Logo';

interface Props {
  title: string;
  body?: string;
  eyebrow?: string;
  loading?: boolean;
  children?: ReactNode;
}

/** A full-screen message: loading, errors, closed rooms, not found. */
export function Notice({ title, body, eyebrow, loading = false, children }: Props) {
  return (
    <div className="relative flex min-h-dvh flex-col">
      <Backdrop />
      <header className="relative z-10 px-5 py-4 md:px-8">
        <Logo />
      </header>
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 pb-24 text-center" aria-busy={loading}>
        {loading && <LoaderCircle size={28} className="mb-5 animate-spin text-indigo" aria-hidden="true" />}
        {eyebrow && <div className="eyebrow mb-3 text-indigo">{eyebrow}</div>}
        <h1 className="max-w-xl font-display text-4xl font-semibold leading-tight md:text-5xl">{title}</h1>
        {body && <p className="mt-3 max-w-md text-ink-soft">{body}</p>}
        {children && <div className="mt-7 flex flex-wrap items-center justify-center gap-3">{children}</div>}
      </main>
    </div>
  );
}
