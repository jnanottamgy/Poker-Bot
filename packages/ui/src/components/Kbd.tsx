import type { ReactNode } from 'react';
import { cx } from '../cx';

export interface KbdProps {
  children: ReactNode;
  className?: string;
}

/** Keyboard key hint, e.g. <Kbd>F</Kbd>. Rendered as <kbd> for assistive tech. */
export function Kbd({ children, className }: KbdProps) {
  return <kbd className={cx('jpb-kbd', className)}>{children}</kbd>;
}
