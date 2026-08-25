import { useMemo } from 'react';
import { useListVisitTypes } from '@workspace/api-client-react';
import type { VisitTypeItem } from '@workspace/api-client-react';
import { visitTypeLabels } from '@/lib/data';

/**
 * Single source of truth for visit types in the web app. Reads the
 * admin-managed catalog (GET /visit-types) so a type Molly adds appears
 * everywhere — the employee log-hours checklist, the admin fix form, the
 * client rate dropdowns, the pay matrix — with no code change.
 *
 * Falls back to the legacy hardcoded labels (src/lib/data.ts) for display so
 * labels always render, even before the catalog loads or for a stored key that
 * predates the catalog.
 */
export interface UseVisitTypesResult {
  /** Active types only, in catalog order — for pickers/dropdowns. */
  visitTypes: VisitTypeItem[];
  /** Every type incl. retired — for resolving labels of historical entries. */
  allVisitTypes: VisitTypeItem[];
  /** key -> human label, with a hardcoded fallback then the key itself. */
  labelFor: (key: string | null | undefined) => string;
  /** key -> short abbreviation, falling back to the label then the key. */
  abbrFor: (key: string | null | undefined) => string;
  isLoading: boolean;
  isError: boolean;
}

export function useVisitTypes(): UseVisitTypesResult {
  const { data, isLoading, isError } = useListVisitTypes();

  return useMemo(() => {
    const all = data ?? [];
    const byKey = new Map(all.map((t) => [t.key, t]));
    const active = all
      .filter((t) => t.active)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));

    const labelFor = (key: string | null | undefined): string => {
      if (!key) return '';
      return (
        byKey.get(key)?.label ??
        (visitTypeLabels as Record<string, string>)[key] ??
        key
      );
    };
    const abbrFor = (key: string | null | undefined): string => {
      if (!key) return '';
      return byKey.get(key)?.abbreviation ?? labelFor(key);
    };

    return {
      visitTypes: active,
      allVisitTypes: all,
      labelFor,
      abbrFor,
      isLoading,
      isError,
    };
  }, [data, isLoading, isError]);
}
