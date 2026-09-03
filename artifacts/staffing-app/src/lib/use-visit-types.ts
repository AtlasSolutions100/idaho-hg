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
  /** The full catalog entry for a key, when it is in the catalog. */
  typeFor: (key: string | null | undefined) => VisitTypeItem | undefined;
  /**
   * How many active types exist before the discipline filter. Lets a caller
   * tell "your profession has none of these" apart from "none are set up",
   * which read identically as an empty list.
   */
  activeCountBeforeFilter: number;
  isLoading: boolean;
  isError: boolean;
}

/**
 * @param discipline The signed-in employee's discipline. When given, the
 *   picker list is narrowed to the types that discipline can perform — an RN
 *   is not offered "Physical Therapy (PTV)", which is the same visit for a
 *   different profession at a different rate. Undefined (the signed-out web
 *   demo) shows everything rather than an empty list.
 */
export function useVisitTypes(discipline?: string | null): UseVisitTypesResult {
  const { data, isLoading, isError } = useListVisitTypes();

  return useMemo(() => {
    const all = data ?? [];
    const byKey = new Map(all.map((t) => [t.key, t]));
    const activeAll = all
      .filter((t) => t.active)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
    // A type with no discipline list is open to everyone. Matching is
    // case-insensitive so a roster value of "rn" still finds "RN".
    const wanted = discipline?.trim().toUpperCase();
    const active = activeAll.filter((t) => {
      const list = t.disciplines ?? [];
      if (list.length === 0) return true;
      if (!wanted) return true;
      return list.some((d) => d.trim().toUpperCase() === wanted);
    });

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
      typeFor: (key) => (key ? byKey.get(key) : undefined),
      activeCountBeforeFilter: activeAll.length,
      isLoading,
      isError,
    };
  }, [data, discipline, isLoading, isError]);
}
