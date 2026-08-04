import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface StoredEmployee {
  id: string;
  name: string;
  role: string;
}

interface EmployeeContextValue {
  employee: StoredEmployee | null;
  /** True while the saved selection is still being loaded from disk. */
  loading: boolean;
  selectEmployee: (employee: StoredEmployee) => Promise<void>;
  clearEmployee: () => Promise<void>;
}

const STORAGE_KEY = 'ihs.selectedEmployee';

const EmployeeContext = createContext<EmployeeContextValue | undefined>(
  undefined,
);

export function EmployeeProvider({ children }: { children: React.ReactNode }) {
  const [employee, setEmployee] = useState<StoredEmployee | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (cancelled) return;
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as StoredEmployee;
            if (parsed && parsed.id && parsed.name) {
              setEmployee(parsed);
            }
          } catch {
            // Corrupt value — treat as no selection.
          }
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectEmployee = useCallback(async (next: StoredEmployee) => {
    setEmployee(next);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  const clearEmployee = useCallback(async () => {
    setEmployee(null);
    await AsyncStorage.removeItem(STORAGE_KEY);
  }, []);

  const value = useMemo(
    () => ({ employee, loading, selectEmployee, clearEmployee }),
    [employee, loading, selectEmployee, clearEmployee],
  );

  return (
    <EmployeeContext.Provider value={value}>
      {children}
    </EmployeeContext.Provider>
  );
}

export function useEmployee(): EmployeeContextValue {
  const ctx = useContext(EmployeeContext);
  if (!ctx) {
    throw new Error('useEmployee must be used inside EmployeeProvider');
  }
  return ctx;
}
