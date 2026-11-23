import { Link } from 'react-router-dom';
import { EmptyState } from '../components/ui';

export default function NotFound() {
  return (
    <div className="card">
      <EmptyState icon="search" title="Page not found" action={<Link to="/" className="btn-primary">Back to dashboard</Link>}>
        The page you are looking for does not exist or has moved.
      </EmptyState>
    </div>
  );
}
