import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { mockOnboardingTasks, type OnboardingTask } from '@/lib/data';
import { CheckCircle2, Circle } from 'lucide-react';

export function OnboardingChecklist() {
  const [tasks, setTasks] = useState(mockOnboardingTasks);

  const completedCount = tasks.filter(t => t.completed).length;
  const requiredCount = tasks.filter(t => t.required).length;
  const completedRequired = tasks.filter(t => t.required && t.completed).length;

  const handleToggle = (taskId: string) => {
    setTasks(prev =>
      prev.map(task =>
        task.id === taskId ? { ...task, completed: !task.completed } : task
      )
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle>New Hire Onboarding</CardTitle>
            <CardDescription>
              Tasks to assign to new employees
            </CardDescription>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold font-mono text-primary">
              {completedRequired}/{requiredCount}
            </div>
            <div className="text-xs text-muted-foreground">Required</div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {tasks.map(task => (
            <div
              key={task.id}
              className="flex items-start gap-4 p-4 rounded-lg border bg-card hover:bg-accent/50 transition-smooth"
              data-testid={`onboarding-task-${task.id}`}
            >
              <Checkbox
                id={task.id}
                checked={task.completed}
                onCheckedChange={() => handleToggle(task.id)}
                className="mt-1"
                data-testid={`checkbox-task-${task.id}`}
              />
              <div className="flex-1 space-y-1">
                <label
                  htmlFor={task.id}
                  className={`block font-medium cursor-pointer ${
                    task.completed ? 'line-through text-muted-foreground' : ''
                  }`}
                >
                  {task.title}
                  {task.required && (
                    <Badge variant="outline" className="ml-2 text-xs">
                      Required
                    </Badge>
                  )}
                </label>
                <p className="text-sm text-muted-foreground">{task.description}</p>
              </div>
              {task.completed ? (
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
              {completedCount}/{tasks.length} tasks completed
            </span>
          </div>
          <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-500"
              style={{ width: `${(completedCount / tasks.length) * 100}%` }}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
