import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { FileQuestion } from 'lucide-react';

export function NotFoundPage(): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20">
      <FileQuestion className="size-16 text-muted-foreground" />
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-muted-foreground">The page you're looking for doesn't exist.</p>
      <Link to="/">
        <Button>Go to dashboard</Button>
      </Link>
    </div>
  );
}

export default NotFoundPage;
