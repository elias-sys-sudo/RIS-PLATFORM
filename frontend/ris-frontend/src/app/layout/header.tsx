import { LogOut, Moon, Sun, Bell, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { useAuthStore } from '@/store/auth.store';
import { useUiStore } from '@/store/ui.store';
import { ROLE_LABELS, type Role } from '@/lib/constants';

export function Header(): React.ReactElement {
  const { user, role, logout } = useAuthStore();
  const { darkMode, toggleDarkMode } = useUiStore();

  const initials = (user?.name ?? 'U')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <header className="glass-header sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border/70 px-4 transition-colors">
      <SidebarTrigger className="-ml-1 text-muted-foreground hover:text-foreground transition-colors" />
      <Separator orientation="vertical" className="mr-1 !h-4 opacity-50" />

      {/* Live System Status Pill */}
      <div className="hidden sm:flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
        <span className="size-1.5 rounded-full bg-emerald-500 animate-live-pulse" />
        <span className="font-semibold tracking-wide">System Operational</span>
      </div>

      <div className="flex-1" />

      {/* Role Pill */}
      {role && (
        <Badge variant="gold" className="hidden md:inline-flex text-[11px] font-semibold tracking-wide uppercase">
          <Shield className="size-3 mr-1 opacity-80" />
          {ROLE_LABELS[role as Role] ?? role}
        </Badge>
      )}

      {/* Dark mode toggle */}
      <Button
        variant="ghost"
        size="icon"
        onClick={toggleDarkMode}
        aria-label="Toggle dark mode"
        className="rounded-full text-muted-foreground hover:text-foreground hover:bg-accent/20 transition-transform active:scale-90"
      >
        {darkMode ? <Sun className="size-4 text-amber-400" /> : <Moon className="size-4" />}
      </Button>

      {/* Notifications */}
      <Button
        variant="ghost"
        size="icon"
        aria-label="Notifications"
        className="relative rounded-full text-muted-foreground hover:text-foreground hover:bg-accent/20"
      >
        <Bell className="size-4" />
        <span className="absolute top-2 right-2 size-2 rounded-full bg-amber-500 animate-ping opacity-75" />
        <span className="absolute top-2 right-2 size-2 rounded-full bg-amber-500" />
      </Button>

      {/* User menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="relative h-8 w-8 rounded-full ring-2 ring-primary/20 hover:ring-primary/40 transition-all p-0">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-gradient-to-br from-primary to-emerald-600 text-primary-foreground text-xs font-bold font-display">
                {initials}
              </AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56 rounded-xl shadow-lg border border-border/80 p-1" align="end" forceMount>
          <DropdownMenuLabel className="font-normal p-2">
            <div className="flex flex-col space-y-1">
              <p className="text-sm font-semibold leading-none font-display">{user?.name ?? 'User'}</p>
              <p className="text-xs leading-none text-muted-foreground font-mono truncate">
                {user?.email ?? ''}
              </p>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator className="my-1" />
          <DropdownMenuItem
            onClick={() => void logout()}
            className="text-destructive focus:text-destructive focus:bg-destructive/10 rounded-lg cursor-pointer transition-colors"
          >
            <LogOut className="mr-2 size-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
