import { createContext, useContext } from 'react';

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  tone?: 'success' | 'danger' | 'info';
  onClick?: () => void;
}

export interface ToastApi {
  toast: (input: Omit<ToastItem, 'id'>) => void;
}

export const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('ToastProvider missing');
  return ctx;
}
