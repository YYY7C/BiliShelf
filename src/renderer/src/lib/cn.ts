import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** 合并 clsx 条件类，并让调用处传入的 Tailwind 类覆盖组件默认值。 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
