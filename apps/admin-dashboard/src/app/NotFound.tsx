import { useNavigate } from 'react-router';
import { EmptyState, Button } from '@jpb/ui';

export function NotFound() {
  const navigate = useNavigate();
  return (
    <EmptyState
      icon="search"
      title="Page not found"
      description="This address does not exist in the control room."
      action={
        <Button variant="primary" onClick={() => navigate('/tournaments')}>
          Go to tournaments
        </Button>
      }
    />
  );
}
