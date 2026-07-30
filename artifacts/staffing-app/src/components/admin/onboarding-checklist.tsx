import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListEmployees,
  useListOnboardingItems,
  useUpdateOnboardingItem,
  getListOnboardingItemsQueryKey,
  type OnboardingItem,
} from '@workspace/api-client-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle2, Circle, AlertCircle } from 'lucide-react';

export function OnboardingChecklist() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [employeeId, setEmployeeId] = useState('');

  const employeesQuery = useListEmployees();
  const itemsQuery = useListOnboardingItems(employeeId, {
    query: {
      enabled: !!employeeId,
      queryKey: getListOnboardingItemsQueryKey(employeeId),
    },
  });

  const updateMutation = useUpdateOnboardingItem({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getListOnboardingItemsQueryKey(employeeId),
        });
      },
      onError: () => {
        toast({
          title: 'Could not save',
          description: 'The checklist item was not updated. Please try again.',
          variant: 'destructive',
        });
      },
    },
  });

  const items = itemsQuery.data ?? [];
  const completedCount = items.filter((i) => i.completed).length;

  const handleToggle = (item: OnboardingItem) => {
    updateMutation.mutate({
      id: employeeId,
      itemKey: item.itemKey,
      data: { completed: !item.completed },
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>New Employee Checklist</CardTitle>
            <CardDescription>
              Items to complete prior to working. Tracking only — documents stay off the app.
            </CardDescription>
          </div>
          {employeeId && items.length > 0 && (
            <div className="text-right">
              <div className="text-2xl font-bold font-mono text-primary" data-testid="text-progress">
                {completedCount}/{items.length}
              </div>
              <div className="text-xs text-muted-foreground">Complete</div>
            </div>
          )}
        </div>
        <div className="pt-2 max-w-xs">
          <Select value={employeeId} onValueChange={setEmployeeId}>
            <SelectTrigger data-testid="select-employee">
              <SelectValue placeholder="Select an employee" />
            </SelectTrigger>
            <SelectContent>
              {(employeesQuery.data ?? []).map((emp) => (
                <SelectItem key={emp.id} value={emp.id} data-testid={`option-employee-${emp.id}`}>
                  {emp.name} ({emp.role})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {!employeeId ? (
          <p className="text-sm text-muted-foreground py-8 text-center" data-testid="text-pick-employee">
            Pick an employee to see their onboarding checklist.
          </p>
        ) : itemsQuery.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        ) : itemsQuery.isError ? (
          <div className="flex items-center gap-2 text-sm text-destructive py-8 justify-center">
            <AlertCircle className="h-4 w-4" />
            Could not load the checklist. Please try again.
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {items.map((item) => (
                <div
                  key={item.itemKey}
                  className="flex items-start gap-4 p-4 rounded-lg border bg-card hover:bg-accent/50 transition-smooth"
                  data-testid={`onboarding-item-${item.itemKey}`}
                >
                  <Checkbox
                    id={item.itemKey}
                    checked={item.completed}
                    onCheckedChange={() => handleToggle(item)}
                    disabled={updateMutation.isPending}
                    className="mt-1"
                    data-testid={`checkbox-item-${item.itemKey}`}
                  />
                  <div className="flex-1 space-y-1">
                    <label
                      htmlFor={item.itemKey}
                      className={`block font-medium cursor-pointer ${
                        item.completed ? 'line-through text-muted-foreground' : ''
                      }`}
                    >
                      {item.label}
                      {item.note && (
                        <Badge variant="outline" className="ml-2 text-xs">
                          {item.note}
                        </Badge>
                      )}
                    </label>
                    {item.completedAt && (
                      <p className="text-sm text-muted-foreground">
                        Completed {new Date(item.completedAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  {item.completed ? (
                    <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                  ) : (
                    <Circle className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                  )}
                </div>
              ))}
            </div>

            <div className="mt-6 pt-6 border-t">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Overall Progress</span>
                <span className="font-medium font-mono">
                  {completedCount}/{items.length} items completed
                </span>
              </div>
              <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-500"
                  style={{
                    width: `${items.length ? (completedCount / items.length) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
