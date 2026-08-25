import type { TimeEntry } from '@workspace/api-client-react';

// Visit types are now an open string keyed off the admin-managed catalog
// (GET /visit-types), so this map is a best-effort display fallback rather than
// an exhaustive enum. Keyed by string: unknown/newly-added types just fall
// through to their raw key at the call site.
export const visitTypeLabels: Record<string, string> = {
  'skilled-nursing': 'Skilled Nursing (SNV)',
  'physical-therapy': 'Physical Therapy (PTV)',
  'occupational-therapy': 'Occupational Therapy',
  'speech-therapy': 'Speech Therapy',
  'soc': 'Start of Care (SOC)',
  'routine-visit': 'Routine Visit',
  'eval': 'Eval / Eval RA',
  'recert': 'Recert / Recert RA',
  'roc': 'Resumption of Care (ROC)',
  'discharge': 'Discharge (DC)',
  'non-visit': 'Non-visit (doc/meeting)',
  'hospital-at-home': 'Hospital at Home',
  'hospice': 'Hospice',
  'training': 'Training',
  'non-billable': 'Non-billable Visit',
  'on-call': 'On Call',
  'mccall-per-diem': 'McCall Per Diem',
  'mie-first-last-day': 'MI&E First/Last Day',
  'mie-full-day': 'MI&E Full Day',
};

export const statusLabels: Record<TimeEntry['status'], string> = {
  draft: 'Draft',
  submitted: 'Waiting for approval',
  approved: 'Approved',
  rejected: 'Rejected',
};
