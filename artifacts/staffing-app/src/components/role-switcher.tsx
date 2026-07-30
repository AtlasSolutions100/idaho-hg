import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Users, UserCircle } from 'lucide-react';

export type UserRole = 'employee' | 'admin';

interface RoleSwitcherProps {
  currentRole: UserRole;
  onRoleChange: (role: UserRole) => void;
}

export function RoleSwitcher({ currentRole, onRoleChange }: RoleSwitcherProps) {
  return (
    <div className="flex items-center gap-2 p-1 bg-muted rounded-lg">
      <Button
        variant={currentRole === 'employee' ? 'default' : 'ghost'}
        size="sm"
        onClick={() => onRoleChange('employee')}
        className="gap-2"
        data-testid="button-switch-employee"
      >
        <UserCircle className="h-4 w-4" />
        <span className="hidden sm:inline">Employee</span>
      </Button>
      <Button
        variant={currentRole === 'admin' ? 'default' : 'ghost'}
        size="sm"
        onClick={() => onRoleChange('admin')}
        className="gap-2"
        data-testid="button-switch-admin"
      >
        <Users className="h-4 w-4" />
        <span className="hidden sm:inline">Admin</span>
      </Button>
    </div>
  );
}
