import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ShieldX } from 'lucide-react';

export function AccessDeniedPage(): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20">
      <ShieldX className="size-16 text-destructive" />
      <h1 className="text-2xl font-semibold">Access denied</h1>
      <p className="text-muted-foreground">You don't have permission to view this page.</p>
      <Link to="/">
        <Button variant="outline">Go to dashboard</Button>
      </Link>
    </div>
  );
}

export default AccessDeniedPage;
