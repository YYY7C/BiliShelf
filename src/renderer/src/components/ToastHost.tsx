import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useEffect } from 'react';
import type { Toast } from '../lib/store';
import { useUi } from '../lib/store';

const STYLE: Record<Toast['kind'], { icon: React.ReactNode; className: string }> = {
  info: { icon: <Info size={13} />, className: 'border-blue/30 bg-blue/10 text-blue' },
  success: { icon: <CheckCircle2 size={13} />, className: 'border-green/30 bg-green/10 text-green' },
  warn: { icon: <AlertTriangle size={13} />, className: 'border-yellow/30 bg-yellow/10 text-yellow' },
  error: { icon: <XCircle size={13} />, className: 'border-red/30 bg-red/10 text-red' }
};

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useUi((state) => state.dismissToast);

  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(toast.id), 4200);
    return () => window.clearTimeout(timer);
  }, [toast.id, dismiss]);

  const style = STYLE[toast.kind];

  return (
    <div
      className={clsx(
        'pointer-events-auto flex max-w-sm items-start gap-2 rounded-lg border px-3 py-2 shadow-xl backdrop-blur',
        style.className
      )}
    >
      <span className="mt-0.5 flex-none">{style.icon}</span>
      <span className="min-w-0 flex-1 text-[11.5px] leading-4 text-fg/90">{toast.message}</span>
      <button
        type="button"
        aria-label="关闭提示"
        onClick={() => dismiss(toast.id)}
        className="mt-0.5 flex-none opacity-60 transition-opacity hover:opacity-100"
      >
        <X size={11} />
      </button>
    </div>
  );
}

export function ToastHost() {
  const toasts = useUi((state) => state.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[340px] flex-col gap-2">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
