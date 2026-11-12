import { AVATARS } from '../../config';
import type { Identity } from '../../lib/identity';

interface Props {
  value: Identity;
  onChange(next: Identity): void;
  autoFocus?: boolean;
}

/** Display name + avatar picker, shared by the create and join screens. */
export function IdentityFields({ value, onChange, autoFocus = false }: Props) {
  return (
    <div className="flex flex-col gap-5">
      <label className="block">
        <span className="eyebrow mb-2 block">Your name</span>
        <input
          className="field"
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
          maxLength={24}
          placeholder="What should people call you?"
          autoComplete="nickname"
          autoFocus={autoFocus}
          required
        />
      </label>
      <fieldset>
        <legend className="eyebrow mb-2">Pick an avatar</legend>
        <div className="grid grid-cols-8 gap-1.5">
          {AVATARS.map((a) => {
            const selected = a === value.avatar;
            return (
              <button
                key={a}
                type="button"
                onClick={() => onChange({ ...value, avatar: a })}
                aria-pressed={selected}
                aria-label={`Avatar ${a}`}
                className={`flex aspect-square items-center justify-center rounded-full text-xl transition-all active:scale-90 ${
                  selected ? 'bg-indigo/15 ring-2 ring-indigo' : 'bg-cream/70 hover:bg-white'
                }`}
              >
                <span aria-hidden="true">{a}</span>
              </button>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}

interface ChoiceProps<T extends string> {
  legend: string;
  value: T;
  onChange(v: T): void;
  options: { value: T; label: string; hint: string }[];
}

/** Two or three labelled options shown as selectable cards. */
export function Choice<T extends string>({ legend, value, onChange, options }: ChoiceProps<T>) {
  return (
    <fieldset>
      <legend className="eyebrow mb-2">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((o) => (
          <label
            key={o.value}
            className={`cursor-pointer border-[1.5px] p-3.5 transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-indigo ${
              value === o.value ? 'border-indigo bg-indigo/10' : 'border-ink/40 bg-cream/60 hover:bg-white'
            }`}
          >
            <input type="radio" className="sr-only" name={legend} checked={value === o.value} onChange={() => onChange(o.value)} />
            <span className="block text-sm font-medium">{o.label}</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-ink-soft">{o.hint}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
