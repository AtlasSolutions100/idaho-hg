import { Users, UserCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export type UserRole = 'employee' | 'admin';

interface RoleSwitcherProps {
  currentRole: UserRole;
  onRoleChange: (role: UserRole) => void;
}

const roles: { value: UserRole; label: string; icon: typeof Users; testId: string }[] = [
  { value: 'employee', label: 'Employee', icon: UserCircle, testId: 'button-switch-employee' },
  { value: 'admin', label: 'Admin', icon: Users, testId: 'button-switch-admin' },
];

export function RoleSwitcher({ currentRole, onRoleChange }: RoleSwitcherProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Select your role"
      className="grid grid-cols-2 gap-1 p-1 bg-muted rounded-xl border border-border/60"
    >
      {roles.map(({ value, label, icon: Icon, testId }) => {
        const selected = currentRole === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onRoleChange(value)}
            data-testid={testId}
            className={cn(
              'flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium',
              'transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
              selected
                ? 'bg-card text-foreground shadow-sm border border-border/70'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon
              className={cn('h-4 w-4 transition-colors duration-200', selected && 'text-primary')}
            />
            {label}
          </button>
        );
      })}
    </div>
  );
}
