import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAdminUsers, useCreateUser } from '../hooks/use-admin';
import { formatRelative } from '@/lib/format-date';
import { STAFF_ROLES, ROLE_LABELS, type Role } from '@/lib/constants';

const createSchema = z.object({ name: z.string().min(2), email: z.string().email(), role: z.string().min(1) });

const STATUS_COLORS: Record<string, string> = { active: 'bg-green-50 text-green-700', inactive: 'bg-gray-50 text-gray-500' };

export function UsersPage(): React.ReactElement {
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const { data, isLoading } = useAdminUsers(page);
  const create = useCreateUser();

  const form = useForm({ resolver: zodResolver(createSchema), defaultValues: { name: '', email: '', role: 'credit_officer' } });

  async function handleCreate(vals: z.infer<typeof createSchema>): Promise<void> {
    await create.mutateAsync(vals as { name: string; email: string; role: Role });
    setShowCreate(false);
    form.reset();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold font-display">User Management</h1><p className="text-sm text-muted-foreground">{data?.total ?? 0} users</p></div>
        <Button onClick={() => setShowCreate(true)}><Plus className="mr-2 size-4" />Create User</Button>
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead>Status</TableHead><TableHead>Last Login</TableHead></TableRow></TableHeader>
          <TableBody>
            {isLoading ? Array.from({ length: 5 }).map((_, i) => <TableRow key={i}>{Array.from({ length: 5 }).map((__, j) => <TableCell key={j}><Skeleton className="h-4 w-16" /></TableCell>)}</TableRow>) :
              data?.data.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.name}</TableCell>
                  <TableCell>{u.email}</TableCell>
                  <TableCell><Badge variant="outline">{ROLE_LABELS[u.role as Role] ?? u.role}</Badge></TableCell>
                  <TableCell><Badge variant="outline" className={STATUS_COLORS[u.status] ?? ''}>{u.status}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{u.lastLogin ? formatRelative(u.lastLogin) : 'Never'}</TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>
      {data && data.total > data.pageSize && (
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <Button variant="outline" size="sm" onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create User</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleCreate)} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (<FormItem><FormLabel>Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="email" render={({ field }) => (<FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="role" render={({ field }) => (
                <FormItem><FormLabel>Role</FormLabel><Select value={field.value} onValueChange={field.onChange}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent>{STAFF_ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>
              )} />
              <DialogFooter><Button type="submit" disabled={create.isPending}>{create.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}Create</Button></DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
export default UsersPage;
