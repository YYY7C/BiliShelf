import clsx from 'clsx';
import { ChevronDown, X } from 'lucide-react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { useEffect } from 'react';

type Variant = 'primary' | 'ghost' | 'subtle' | 'danger';
type Size = 'sm' | 'md';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-pink/90 text-white hover:bg-pink border border-pink/40 shadow-[0_6px_20px_-8px_rgba(251,114,153,0.7)]',
  ghost: 'bg-transparent text-muted hover:text-fg hover:bg-panel2 border border-transparent',
  subtle: 'bg-panel2 text-fg hover:bg-panel3 border border-line/70',
  danger: 'bg-red/15 text-red hover:bg-red/25 border border-red/30'
};

const SIZES: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-[12px] gap-1.5 rounded-md',
  md: 'h-9 px-3.5 text-[13px] gap-2 rounded-lg'
};

export function Button({
  variant = 'subtle',
  size = 'md',
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      type="button"
      className={clsx(
        'inline-flex select-none items-center justify-center font-medium transition-colors disabled:pointer-events-none disabled:opacity-40',
        VARIANTS[variant],
        SIZES[size],
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function IconButton({
  className,
  children,
  label,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={clsx(
        'inline-flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-muted transition-colors',
        'hover:border-line hover:bg-panel2 hover:text-fg disabled:opacity-40',
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Chip({
  children,
  active,
  tone = 'default',
  onClick,
  title
}: {
  children: ReactNode;
  active?: boolean;
  tone?: 'default' | 'pink' | 'blue' | 'green' | 'yellow' | 'red' | 'purple';
  onClick?: () => void;
  title?: string;
}) {
  const tones: Record<string, string> = {
    default: 'border-line text-muted',
    pink: 'border-pink/30 text-pink',
    blue: 'border-blue/30 text-blue',
    green: 'border-green/30 text-green',
    yellow: 'border-yellow/30 text-yellow',
    red: 'border-red/30 text-red',
    purple: 'border-purple/30 text-purple'
  };
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={!onClick}
      className={clsx(
        'inline-flex max-w-full items-center gap-1 truncate rounded-md border px-1.5 py-0.5 text-[11px] leading-5 transition-colors',
        tones[tone],
        active ? 'bg-panel3 text-fg' : 'bg-panel2/60',
        onClick ? 'hover:bg-panel3 hover:text-fg' : 'cursor-default'
      )}
    >
      {children}
    </button>
  );
}

export function Tag({
  children,
  tone = 'default',
  className
}: {
  children: ReactNode;
  tone?: 'default' | 'pink' | 'blue' | 'green' | 'yellow' | 'red' | 'purple';
  className?: string;
}) {
  const tones: Record<string, string> = {
    default: 'bg-panel3/70 text-muted border-line/60',
    pink: 'bg-pink/12 text-pink border-pink/25',
    blue: 'bg-blue/12 text-blue border-blue/25',
    green: 'bg-green/12 text-green border-green/25',
    yellow: 'bg-yellow/12 text-yellow border-yellow/25',
    red: 'bg-red/12 text-red border-red/25',
    purple: 'bg-purple/12 text-purple border-purple/25'
  };
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10.5px] leading-4',
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={clsx('h-1.5 w-full overflow-hidden rounded-full bg-panel3', className)}>
      <div
        className="h-full rounded-full bg-gradient-to-r from-pink to-blue transition-[width] duration-300"
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
      />
    </div>
  );
}

export function Field({
  label,
  hint,
  children
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-muted">{label}</span>
      {children}
      {hint ? <span className="text-[11px] leading-4 text-dim">{hint}</span> : null}
    </label>
  );
}

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={clsx(
        'h-9 w-full rounded-lg border border-line bg-panel2 px-3 text-[13px] text-fg placeholder:text-dim',
        'focus:border-blue/50 focus:outline-none focus:ring-2 focus:ring-blue/15',
        className
      )}
      {...rest}
    />
  );
}

export function Select({
  value,
  onChange,
  options,
  icon,
  title
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  icon?: ReactNode;
  title?: string;
}) {
  return (
    <label
      title={title}
      className="relative inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-panel2 pl-2 pr-1 text-[12px] text-muted"
    >
      {icon}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-full cursor-pointer appearance-none bg-transparent pr-4 text-[12px] text-fg focus:outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} className="bg-panel text-fg">
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown size={12} className="pointer-events-none absolute right-1.5 text-dim" />
    </label>
  );
}

export function Toggle({  checked,
  onChange,
  label,
  hint
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="min-w-0">
        <div className="text-[13px] text-fg">{label}</div>
        {hint ? <div className="mt-0.5 text-[11px] leading-4 text-dim">{hint}</div> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={clsx(
          'relative mt-0.5 h-5 w-9 flex-none rounded-full border transition-colors',
          checked ? 'border-pink/50 bg-pink/70' : 'border-line bg-panel3'
        )}
      >
        <span
          className={clsx(
            'absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-all',
            checked ? 'left-[18px]' : 'left-0.5'
          )}
        />
      </button>
    </div>
  );
}

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  width = 'max-w-3xl'
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div
        className={clsx(
          'relative flex max-h-[86vh] w-full flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl',
          width
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line2 px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-fg">{title}</h2>
            {subtitle ? <p className="mt-1 text-[12px] text-dim">{subtitle}</p> : null}
          </div>
          <IconButton label="关闭" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </header>
        <div className="scroll-thin flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={clsx(
        'inline-block h-4 w-4 animate-spin rounded-full border-2 border-line border-t-pink',
        className
      )}
    />
  );
}

export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-2 pb-1 pt-3">
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-dim">{children}</span>
      {right}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-line bg-panel2 px-1 font-mono text-[10px] text-muted">{children}</kbd>
  );
}
