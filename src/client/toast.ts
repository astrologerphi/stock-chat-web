import { useEffect, useState } from 'preact/hooks';

export type ToastTone = 'info' | 'success' | 'error';
export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

let toasts: Toast[] = [];
let seq = 0;
const listeners = new Set<(t: Toast[]) => void>();
const emit = () => listeners.forEach((l) => l(toasts));

export function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function toast(message: string, tone: ToastTone = 'info') {
  const id = ++seq;
  toasts = [...toasts.slice(-3), { id, message, tone }];
  emit();
  setTimeout(() => dismiss(id), tone === 'error' ? 7000 : 4000);
}

export function useToasts() {
  const [state, set] = useState(toasts);
  useEffect(() => {
    listeners.add(set);
    return () => void listeners.delete(set);
  }, []);
  return state;
}
