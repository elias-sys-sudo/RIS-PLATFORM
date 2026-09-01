import { Providers } from '@/app/providers';
import { AppRoutes } from '@/app/routes';

export function App(): React.ReactElement {
  return (
    <Providers>
      <AppRoutes />
    </Providers>
  );
}

export default App;
