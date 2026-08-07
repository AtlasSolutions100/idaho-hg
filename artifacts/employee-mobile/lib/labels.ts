import type { TimeEntry, VisitType } from '@workspace/api-client-react';

export const visitTypeLabels: Record<VisitType, string> = {
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
