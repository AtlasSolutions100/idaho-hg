// Realistic placeholder data for the Phase 1 shell

export type VisitType =
  | 'skilled-nursing'
  | 'physical-therapy'
  | 'occupational-therapy'
  | 'speech-therapy'
  | 'soc'
  | 'routine-visit'
  | 'eval'
  | 'recert'
  | 'roc'
  | 'discharge'
  | 'non-visit'
  | 'hospital-at-home'
  | 'hospice'
  | 'training'
  | 'non-billable'
  | 'on-call'
  | 'mccall-per-diem'
  | 'mie-first-last-day'
  | 'mie-full-day';
export type EntryStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

export interface Client {
  id: string;
  name: string;
  active: boolean;
}

export interface Employee {
  id: string;
  name: string;
  role: 'RN' | 'PT' | 'OT' | 'ST';
  active: boolean;
}

export interface TimeEntry {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeRole: string;
  clientId: string;
  clientName: string;
  date: string;
  visitType?: VisitType;
  hours?: number;
  mileage?: number;
  perDiem?: number;
  isWeekend: boolean;
  isHoliday: boolean;
  note?: string;
  status: EntryStatus;
  submittedAt?: string;
  approvedAt?: string;
}

export interface ClientRate {
  id: string;
  clientId: string;
  clientName: string;
  visitType: VisitType;
  rate: number;
  effectiveDate: string;
}

export interface EmployeeRate {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeRole: string;
  hourlyRate: number;
  visitRate: number;
  mileageRate: number;
  perDiemRate: number;
  weekendMultiplier: number;
  holidayMultiplier: number;
  effectiveDate: string;
}


// Mock data
export const mockClients: Client[] = [
  { id: '1', name: "St. Luke's Health System", active: true },
  { id: '2', name: 'Weiser Memorial Hospital', active: true },
  { id: '3', name: 'Idaho Youth Ranch', active: true },
  { id: '4', name: 'Treasure Valley Outpatient Clinic', active: true },
  { id: '5', name: 'Meridian Senior Care', active: true },
];

export const mockEmployees: Employee[] = [
  { id: '1', name: 'Sarah Martinez', role: 'RN', active: true },
  { id: '2', name: 'James Chen', role: 'PT', active: true },
  { id: '3', name: 'Emily Rodriguez', role: 'RN', active: true },
  { id: '4', name: 'Michael Thompson', role: 'OT', active: true },
  { id: '5', name: 'Jessica Park', role: 'PT', active: true },
  { id: '6', name: 'David Williams', role: 'RN', active: true },
];

export const mockTimeEntries: TimeEntry[] = [
  {
    id: '1',
    employeeId: '1',
    employeeName: 'Sarah Martinez',
    employeeRole: 'RN',
    clientId: '1',
    clientName: "St. Luke's Health System",
    date: '2024-01-15',
    visitType: 'skilled-nursing',
    hours: undefined,
    mileage: 24,
    perDiem: 0,
    isWeekend: false,
    isHoliday: false,
    note: 'Patient assessment and wound care',
    status: 'submitted',
    submittedAt: '2024-01-15T18:30:00Z',
  },
  {
    id: '2',
    employeeId: '2',
    employeeName: 'James Chen',
    employeeRole: 'PT',
    clientId: '2',
    clientName: 'Weiser Memorial Hospital',
    date: '2024-01-15',
    hours: 6.5,
    mileage: 48,
    perDiem: 1,
    isWeekend: false,
    isHoliday: false,
    note: 'Long drive to Weiser, full day coverage',
    status: 'submitted',
    submittedAt: '2024-01-15T19:00:00Z',
  },
  {
    id: '3',
    employeeId: '3',
    employeeName: 'Emily Rodriguez',
    employeeRole: 'RN',
    clientId: '3',
    clientName: 'Idaho Youth Ranch',
    date: '2024-01-14',
    visitType: 'skilled-nursing',
    mileage: 12,
    perDiem: 0,
    isWeekend: true,
    isHoliday: false,
    note: 'Weekend coverage',
    status: 'approved',
    submittedAt: '2024-01-14T17:00:00Z',
    approvedAt: '2024-01-15T09:00:00Z',
  },
  {
    id: '4',
    employeeId: '4',
    employeeName: 'Michael Thompson',
    employeeRole: 'OT',
    clientId: '4',
    clientName: 'Treasure Valley Outpatient Clinic',
    date: '2024-01-16',
    hours: 8,
    mileage: 18,
    perDiem: 0,
    isWeekend: false,
    isHoliday: false,
    status: 'submitted',
    submittedAt: '2024-01-16T16:45:00Z',
  },
  {
    id: '5',
    employeeId: '5',
    employeeName: 'Jessica Park',
    employeeRole: 'PT',
    clientId: '1',
    clientName: "St. Luke's Health System",
    date: '2024-01-16',
    visitType: 'physical-therapy',
    mileage: 22,
    perDiem: 0,
    isWeekend: false,
    isHoliday: false,
    status: 'submitted',
    submittedAt: '2024-01-16T17:30:00Z',
  },
  {
    id: '6',
    employeeId: '1',
    employeeName: 'Sarah Martinez',
    employeeRole: 'RN',
    clientId: '5',
    clientName: 'Meridian Senior Care',
    date: '2024-01-16',
    hours: 4.5,
    mileage: 8,
    perDiem: 0,
    isWeekend: false,
    isHoliday: false,
    note: 'Half day - medication administration training',
    status: 'submitted',
    submittedAt: '2024-01-16T14:00:00Z',
  },
];


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

export const clientRateTypeLabels: Record<string, string> = {
  ...visitTypeLabels,
  hourly: 'Hourly',
};
export const statusLabels: Record<EntryStatus, string> = {
  'draft': 'Draft',
  'submitted': 'Waiting for approval',
  'approved': 'Approved',
  'rejected': 'Rejected',
};
