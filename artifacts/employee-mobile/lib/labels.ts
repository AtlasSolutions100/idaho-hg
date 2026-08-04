import type { TimeEntry, VisitType } from '@workspace/api-client-react';

export const visitTypeLabels: Record<VisitType, string> = {
  'skilled-nursing': 'Skilled Nursing',
  'physical-therapy': 'Physical Therapy',
  'occupational-therapy': 'Occupational Therapy',
  'speech-therapy': 'Speech Therapy',
};

export const statusLabels: Record<TimeEntry['status'], string> = {
  submitted: 'Waiting for approval',
  approved: 'Approved',
  rejected: 'Rejected',
};
