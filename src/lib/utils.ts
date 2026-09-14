import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** shadcn/ui 组件共用的 Tailwind class 合并器。 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
