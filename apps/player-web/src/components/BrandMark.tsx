import { cx } from '@jpb/ui';

export function BrandMark({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <span className={cx('pw-brand', compact && 'is-compact', className)}>
      <span className="pw-brand__logo" aria-hidden="true">
        ♠
      </span>
      {!compact && <span className="pw-brand__text">Johnny&apos;s Poker Bot</span>}
    </span>
  );
}
