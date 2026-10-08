import { Link } from 'react-router';
import { EmptyState } from '@jpb/ui';

export function NotFoundPage() {
  return (
    <div className="pw-center">
      <EmptyState icon="search" title="Page not found" description="Scan the tournament QR code again, or go back to the start." action={<Link to="/">Go to start</Link>} />
    </div>
  );
}
