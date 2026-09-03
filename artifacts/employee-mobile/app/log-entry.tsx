import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListTimeEntriesQueryKey,
  getListVisitTypesQueryKey,
  useBatchCreateTimeEntries,
  useCreateTimeEntry,
  useUpdateTimeEntry,
  useGetMyEmployee,
  useListClients,
  useListTimeEntries,
  useListVisitTypes,
  type PerDiemType,
  type VisitType,
} from '@workspace/api-client-react';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import colors from '@/constants/colors';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useColors } from '@/hooks/useColors';
import { visitTypeLabels } from '@/lib/labels';

function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatPretty(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

const TIME_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

/** "822" → "8:22", "0822" → "08:22" — lets people type without the colon. */
export function normalizeTimeInput(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '');
  if (raw.includes(':') || digits.length < 3) return raw;
  const mm = digits.slice(-2);
  const hh = digits.slice(0, -2).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** Hours between two "HH:MM" times; earlier/equal time out = crossed midnight. */
export function calculateHours(timeIn: string, timeOut: string): number | null {
  if (!TIME_PATTERN.test(timeIn) || !TIME_PATTERN.test(timeOut)) return null;
  const [inH, inM] = timeIn.split(':').map(Number);
  const [outH, outM] = timeOut.split(':').map(Number);
  let minutes = outH! * 60 + outM! - (inH! * 60 + inM!);
  if (minutes <= 0) minutes += 24 * 60;
  return Math.round((minutes / 60) * 100) / 100;
}

/** The last 14 days, today first — covers normal weekly submission habits. */
function recentDates(): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 0; i < 14; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    out.push(toDateString(d));
  }
  return out;
}

/** One chosen visit line: a visit type and how many of it. */
type VisitLine = {
  visitType: VisitType;
  /** Visits, or 15-minute blocks for a type billed in increments. */
  quantity: number;
};

export default function LogEntryScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  // Server derives the employee from the signed-in session; we only need it
  // here to know the form is ready to submit.
  const { data: employee } = useGetMyEmployee();
  // Edit mode: /log-entry?id=123 opens an existing draft/submitted/rejected
  // entry prefilled. The entry comes from the already-cached list.
  const { id: editId } = useLocalSearchParams<{ id?: string }>();
  const { data: allEntries, isLoading: entriesLoading } = useListTimeEntries(undefined, {
    query: { enabled: !!editId, queryKey: getListTimeEntriesQueryKey() },
  });
  const editingEntry = editId
    ? (allEntries ?? []).find((e) => e.id === editId)
    : undefined;

  const [entryType, setEntryType] = useState<'visit' | 'hourly' | 'other'>('visit');
  const [clientId, setClientId] = useState('');
  // The visits chosen for this day, each with how many. Tapping a type again
  // adds another of the same, so "two evals and a discharge" is three taps.
  const [visitLines, setVisitLines] = useState<VisitLine[]>([]);
  const [timeIn, setTimeIn] = useState('');
  const [timeOut, setTimeOut] = useState('');
  const [date, setDate] = useState(toDateString(new Date()));
  const [hasMileage, setHasMileage] = useState(false);
  const [mileage, setMileage] = useState('');
  // St. Luke's employees pull a mileage report off the client's device for a
  // whole pay period, so mileage can cover a range rather than a single day.
  const [mileageIsRange, setMileageIsRange] = useState(false);
  const [mileageEndDate, setMileageEndDate] = useState('');
  const [perDiemType, setPerDiemType] = useState<PerDiemType | ''>('');
  const [note, setNote] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [savingAction, setSavingAction] = useState<'draft' | 'submit'>('submit');
  const [prefilledId, setPrefilledId] = useState<string | null>(null);

  // Prefill once the entry is available (list may still be loading).
  React.useEffect(() => {
    if (!editingEntry || prefilledId === editingEntry.id) return;
    setPrefilledId(editingEntry.id);
    setEntryType(editingEntry.isOther ? 'other' : editingEntry.visitType ? 'visit' : 'hourly');
    setClientId(editingEntry.clientId);
    setVisitLines(
      editingEntry.visitType
        ? [{ visitType: editingEntry.visitType, quantity: editingEntry.quantity ?? 1 }]
        : [],
    );
    setTimeIn(editingEntry.timeIn ?? '');
    setTimeOut(editingEntry.timeOut ?? '');
    setDate(editingEntry.date);
    setHasMileage(!!editingEntry.mileage);
    setMileage(editingEntry.mileage ? String(editingEntry.mileage) : '');
    setMileageIsRange(!!editingEntry.endDate);
    setMileageEndDate(editingEntry.endDate ?? '');
    setPerDiemType(editingEntry.perDiemType ?? '');
    setNote(editingEntry.note ?? '');
  }, [editingEntry, prefilledId]);

  const isEditing = !!editId;

  const dates = useMemo(recentDates, []);
  const { data: clients, isLoading: clientsLoading } = useListClients();

  const createEntry = useCreateTimeEntry();
  const updateEntry = useUpdateTimeEntry();
  const batchCreateEntries = useBatchCreateTimeEntries();

  const selectedClient = (clients ?? []).find((cl) => cl.id === clientId);
  // Clients whose contract doesn't include mileage never see the toggle.
  const mileageAllowed = selectedClient ? selectedClient.mileageOnContract : true;
  // Visit types only apply to clients that bill by visit type (St. Luke's);
  // everyone else gets the simple time-in/time-out form.
  const billsByVisit = selectedClient?.billsByVisitType ?? false;

  // Visit types come from the admin-managed catalog (GET /visit-types) rather
  // than a hardcoded list, so Molly can add or retire types with no app
  // release. Only fetch it for clients that actually bill by visit type.
  const { data: visitTypeCatalog, isLoading: visitTypesLoading } = useListVisitTypes({
    query: { enabled: billsByVisit, queryKey: getListVisitTypesQueryKey() },
  });
  // Active types only, in the order the admin arranged them, narrowed to the
  // ones this employee's discipline performs. A type with no discipline list
  // is open to everyone; an RN is not offered "Physical Therapy (PTV)", which
  // is the same visit for a different profession at a different rate.
  const discipline = employee?.role;
  const activeVisitTypes = useMemo(() => {
    const wanted = discipline?.trim().toUpperCase();
    return (visitTypeCatalog ?? [])
      .filter((vt) => vt.active)
      .filter((vt) => {
        const list = vt.disciplines ?? [];
        if (list.length === 0 || !wanted) return true;
        return list.some((d) => d.trim().toUpperCase() === wanted);
      })
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [visitTypeCatalog, discipline]);
  // Types exist but none are for this discipline — worth saying so rather
  // than showing the same empty list as "none set up".
  const hiddenByDiscipline =
    activeVisitTypes.length === 0 &&
    (visitTypeCatalog ?? []).some((vt) => vt.active);
  // What the picker renders: the filtered catalog, plus any already-chosen
  // type that's no longer in it (retired, or outside this discipline after a
  // change) so a selection never silently vanishes. labels.ts is the display
  // fallback for those stragglers, falling through to the raw key.
  const visitTypeOptions = useMemo(() => {
    const options = activeVisitTypes.map((vt) => ({
      key: vt.key,
      label: vt.label,
      billingUnit: vt.billingUnit,
      incrementMinutes: vt.incrementMinutes,
    }));
    const known = new Set(options.map((o) => o.key));
    for (const line of visitLines) {
      if (!known.has(line.visitType)) {
        const fromCatalog = (visitTypeCatalog ?? []).find((vt) => vt.key === line.visitType);
        options.push({
          key: line.visitType,
          label: fromCatalog?.label ?? visitTypeLabels[line.visitType] ?? line.visitType,
          billingUnit: fromCatalog?.billingUnit ?? 'visit',
          incrementMinutes: fromCatalog?.incrementMinutes ?? 15,
        });
      }
    }
    return options;
  }, [activeVisitTypes, visitLines, visitTypeCatalog]);
  const visitTypeByKey = useMemo(
    () => new Map(visitTypeOptions.map((o) => [o.key, o])),
    [visitTypeOptions],
  );
  // "Other" one-offs (training, meetings) are available for any client;
  // Visit only for clients that bill by visit type.
  const effectiveEntryType: 'visit' | 'hourly' | 'other' =
    entryType === 'other' ? 'other' : billsByVisit ? entryType : 'hourly';
  const isOther = effectiveEntryType === 'other';
  const calculatedHours = useMemo(() => calculateHours(timeIn, timeOut), [timeIn, timeOut]);
  const overnight = calculatedHours != null && timeIn >= timeOut;
  const timesValid = effectiveEntryType === 'visit' || calculatedHours != null;
  const mileageNumber = mileage ? parseFloat(mileage) : 0;
  const mileageValid =
    !hasMileage || !mileage || (!Number.isNaN(mileageNumber) && mileageNumber >= 0);
  // A mileage-only entry (no visit, no clock times) is the only shape the
  // server lets span a date range.
  const mileageOnly =
    effectiveEntryType === 'hourly' && !timeIn && !timeOut && hasMileage && mileageNumber > 0;
  const rangeValid = !mileageIsRange || !mileageOnly || (!!mileageEndDate && mileageEndDate >= date);
  const totalVisits = visitLines.reduce((sum, l) => sum + l.quantity, 0);
  const canSubmit =
    !!employee &&
    // Edit mode: block saving until the target entry has loaded and is
    // still editable — never silently create a new entry instead.
    (!isEditing || (!!editingEntry && editingEntry.status !== 'approved')) &&
    !!clientId &&
    !!date &&
    (effectiveEntryType === 'visit'
      ? visitLines.length > 0
      : mileageOnly || timesValid) &&
    (!isOther || !!note.trim()) &&
    mileageValid &&
    rangeValid &&
    !isSubmitting &&
    !saved;

  // Tapping a chip adds one of that visit; editing an entry replaces the
  // single line it holds instead.
  const addVisit = (vt: VisitType) => {
    setVisitLines((prev) => {
      if (isEditing) return [{ visitType: vt, quantity: 1 }];
      const existing = prev.find((l) => l.visitType === vt);
      if (!existing) return [...prev, { visitType: vt, quantity: 1 }];
      return prev.map((l) =>
        l.visitType === vt ? { ...l, quantity: Math.min(l.quantity + 1, 100) } : l,
      );
    });
  };

  const setVisitQuantity = (vt: string, quantity: number) => {
    setVisitLines((prev) =>
      quantity <= 0
        ? prev.filter((l) => l.visitType !== vt)
        : prev.map((l) => (l.visitType === vt ? { ...l, quantity: Math.min(quantity, 100) } : l)),
    );
  };

  if (!employee) return <Redirect href="/sign-in" />;

  const save = async (action: 'draft' | 'submit') => {
    if (!canSubmit || !employee) return;
    // Never fall through to creating a brand-new entry when we were asked to
    // edit one — if the target isn't loaded, saving is blocked below anyway.
    if (isEditing && !editingEntry) return;
    setErrorMessage(null);
    setSavingAction(action);
    setIsSubmitting(true);

    try {
      if (isEditing && editingEntry) {
        await updateEntry.mutateAsync({
          id: editingEntry.id,
          data: {
            clientId,
            date,
            ...(effectiveEntryType === 'visit' && visitLines[0]
              ? { visitType: visitLines[0].visitType, quantity: visitLines[0].quantity }
              : {}),
            ...(effectiveEntryType !== 'visit' && timesValid ? { timeIn, timeOut } : {}),
            ...(mileageAllowed && hasMileage && mileageNumber > 0
              ? { mileage: mileageNumber }
              : {}),
            ...(mileageAllowed && mileageOnly && mileageIsRange && mileageEndDate
              ? { endDate: mileageEndDate }
              : {}),
            ...(!isOther && perDiemType ? { perDiemType } : {}),
            ...(note.trim() ? { note: note.trim() } : {}),
            status: action === 'draft' ? 'draft' : 'submitted',
          },
        });
      } else if (effectiveEntryType === 'visit') {
        // Single atomic batch request — all visit types in one transaction.
        // If anything fails the whole batch rolls back; no partial state.
        await batchCreateEntries.mutateAsync({
          data: {
            employeeId: employee.id,
            clientId,
            date,
            visits: visitLines,
            ...(mileageAllowed && hasMileage && mileageNumber > 0
              ? { mileage: mileageNumber }
              : {}),
            ...(perDiemType ? { perDiemType } : {}),
            ...(note.trim() ? { note: note.trim() } : {}),
            ...(action === 'draft' ? { status: 'draft' as const } : {}),
          },
        });
      } else {
        await createEntry.mutateAsync({
          data: {
            employeeId: employee.id,
            clientId,
            date,
            ...(timesValid && !mileageOnly ? { timeIn, timeOut } : {}),
            ...(mileageAllowed && hasMileage && mileageNumber > 0
              ? { mileage: mileageNumber }
              : {}),
            ...(mileageAllowed && mileageOnly && mileageIsRange && mileageEndDate
              ? { endDate: mileageEndDate }
              : {}),
            ...(!isOther && perDiemType ? { perDiemType } : {}),
            ...(note.trim() ? { note: note.trim() } : {}),
            ...(isOther ? { isOther: true } : {}),
            ...(action === 'draft' ? { status: 'draft' as const } : {}),
          },
        });
      }

      queryClient.invalidateQueries({ queryKey: getListTimeEntriesQueryKey() });
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      setSaved(true);
      setTimeout(() => router.back(), 900);
      return;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : undefined;
      setErrorMessage(
        msg ?? "We couldn't save your hours. Please check your connection and try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const topInset = Platform.OS === 'web' ? 67 : Math.max(insets.top, 12);
  const bottomInset = Platform.OS === 'web' ? 34 : insets.bottom;

  // Edit mode with no loaded target: show a loader while the list fetches,
  // and a clear message if the entry can't be found or is already locked —
  // never a blank "new entry" form that would create a duplicate.
  if (isEditing && (!editingEntry || editingEntry.status === 'approved')) {
    return (
      <View style={[styles.container, { backgroundColor: c.background }]}>
        <View
          style={[
            styles.header,
            { paddingTop: topInset, backgroundColor: c.card, borderBottomColor: c.border },
          ]}
        >
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.closeButton} testID="button-close">
            <Feather name="x" size={22} color={c.mutedForeground} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: c.foreground }]}>Edit Entry</Text>
          <View style={styles.closeButton} />
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          {entriesLoading ? (
            <ActivityIndicator color={c.mutedForeground} />
          ) : (
            <>
              <Feather
                name={editingEntry?.status === 'approved' ? 'lock' : 'alert-circle'}
                size={28}
                color={c.mutedForeground}
              />
              <Text
                style={[styles.helperText, { color: c.mutedForeground, textAlign: 'center', marginTop: 12, fontSize: 14 }]}
                testID="text-edit-unavailable"
              >
                {editingEntry?.status === 'approved'
                  ? 'This entry has been approved and can no longer be changed. Ask Molly if something looks wrong.'
                  : "We couldn't find that entry. Pull to refresh your list and try again."}
              </Text>
            </>
          )}
        </View>
      </View>
    );
  }

  const submitLabel = saved
    ? savingAction === 'draft'
      ? 'Draft saved!'
      : 'Submitted!'
    : isSubmitting && savingAction === 'submit'
      ? 'Submitting…'
      : !isEditing && effectiveEntryType === 'visit' && totalVisits > 1
        ? `Submit ${totalVisits} Visits`
        : isEditing && editingEntry?.status !== 'draft'
          ? 'Save & Resubmit'
          : 'Submit Hours';
  // Drafts can be saved on new entries and when re-saving an existing draft.
  const canSaveDraft = !isEditing || editingEntry?.status === 'draft';

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          {
            paddingTop: topInset,
            backgroundColor: c.card,
            borderBottomColor: c.border,
          },
        ]}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={styles.closeButton}
          testID="button-close"
        >
          <Feather name="x" size={22} color={c.mutedForeground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: c.foreground }]}>
          {isEditing ? 'Edit Entry' : 'Log Hours'}
        </Text>
        <View style={styles.closeButton} />
      </View>

      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[
          styles.content,
          { paddingBottom: bottomInset + 32 },
        ]}
        keyboardShouldPersistTaps="handled"
        bottomOffset={24}
      >
        {/* Client */}
        <SectionLabel text="Client" required />
        {clientsLoading ? (
          <View style={[styles.loadingRow, { backgroundColor: c.muted }]}>
            <ActivityIndicator color={c.mutedForeground} />
          </View>
        ) : (
          <View style={styles.chipWrap}>
            {(clients ?? []).map((client) => (
              <Chip
                key={client.id}
                label={client.name}
                selected={clientId === client.id}
                onPress={() => {
                  setClientId(client.id);
                  // Visit selections belong to the previous client — never
                  // carry them over when switching.
                  setVisitLines([]);
                }}
                testID={`chip-client-${client.id}`}
              />
            ))}
          </View>
        )}

        {/* Date */}
        <SectionLabel text="Date" required />
        <View style={styles.chipWrap}>
          {dates.map((d, i) => (
            <Chip
              key={d}
              label={i === 0 ? 'Today' : i === 1 ? 'Yesterday' : formatPretty(d)}
              selected={date === d}
              onPress={() => setDate(d)}
              testID={`chip-date-${d}`}
            />
          ))}
        </View>

        {/* What kind of work: Visit only for clients that bill by visit type
            (St. Luke's); "Other" one-offs (training, meetings) for everyone.
            An entry never changes kind between Other and normal, so editing
            locks the choice. */}
        {!isOther && (!isEditing || billsByVisit) && (
          <>
        <SectionLabel text="What are you logging?" />
        <View style={[styles.segment, { backgroundColor: c.muted }]}>
          {(isEditing
            ? (['visit', 'hourly'] as const)
            : billsByVisit
              ? (['visit', 'hourly', 'other'] as const)
              : (['hourly', 'other'] as const)
          ).map((t) => (
            <Pressable
              key={t}
              onPress={() => setEntryType(t)}
              style={[
                styles.segmentItem,
                effectiveEntryType === t && {
                  backgroundColor: c.card,
                  shadowColor: '#000',
                  shadowOpacity: 0.08,
                  shadowRadius: 4,
                  shadowOffset: { width: 0, height: 1 },
                  elevation: 2,
                },
              ]}
              testID={`tab-${t}`}
            >
              <Text
                style={[
                  styles.segmentText,
                  {
                    color: effectiveEntryType === t ? c.foreground : c.mutedForeground,
                  },
                ]}
              >
                {t === 'visit' ? 'A visit' : t === 'hourly' ? 'Hourly work' : 'Other'}
              </Text>
            </Pressable>
          ))}
        </View>
          </>
        )}

        {isOther && (
          <>
            <SectionLabel text="What was it?" required />
            <Text style={[styles.helperText, { color: c.mutedForeground, marginTop: 0, marginBottom: 8 }]}>
              One-offs like training, meetings, or professional development.
              Molly sets the pay when she reviews it.
            </Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder='e.g. "3 hours professional development at Weiser School District"'
              placeholderTextColor={c.mutedForeground}
              multiline
              numberOfLines={3}
              style={[
                styles.input,
                styles.noteInput,
                {
                  backgroundColor: c.card,
                  borderColor: c.input,
                  color: c.foreground,
                },
              ]}
              testID="input-other-description"
            />
          </>
        )}

        {effectiveEntryType === 'visit' ? (
          <>
            <SectionLabel text="Visits" required />
            <Text style={[styles.helperText, { color: c.mutedForeground, marginTop: 0, marginBottom: 8 }]}>
              {isEditing
                ? 'Pick the visit type for this entry'
                : 'Tap each visit you did — tap again to add a second one'}
            </Text>

            {/* What's been chosen so far, with a count that can be adjusted. */}
            {visitLines.length > 0 && (
              <View style={{ marginBottom: 8, gap: 8 }}>
                {visitLines.map((line) => {
                  const type = visitTypeByKey.get(line.visitType);
                  const isIncrement = type?.billingUnit === 'increment';
                  const perBlock = type?.incrementMinutes ?? 15;
                  return (
                    <View
                      key={line.visitType}
                      style={[styles.visitLineRow, { backgroundColor: c.card, borderColor: c.border }]}
                      testID={`visit-line-${line.visitType}`}
                    >
                      <Text style={[styles.visitLineLabel, { color: c.foreground }]} numberOfLines={1}>
                        {type?.label ?? visitTypeLabels[line.visitType] ?? line.visitType}
                      </Text>
                      {!isEditing && (
                        <View style={styles.visitLineStepper}>
                          <Pressable
                            onPress={() => setVisitQuantity(line.visitType, line.quantity - 1)}
                            style={[styles.stepperButton, { borderColor: c.input }]}
                            testID={`visit-minus-${line.visitType}`}
                            accessibilityLabel={`One fewer ${type?.label ?? line.visitType}`}
                          >
                            <Feather name="minus" size={14} color={c.foreground} />
                          </Pressable>
                          <Text
                            style={[styles.visitLineCount, { color: c.foreground }]}
                            testID={`visit-quantity-${line.visitType}`}
                          >
                            {isIncrement
                              ? formatDuration(line.quantity, perBlock)
                              : `${line.quantity} ${line.quantity === 1 ? 'visit' : 'visits'}`}
                          </Text>
                          <Pressable
                            onPress={() => setVisitQuantity(line.visitType, line.quantity + 1)}
                            style={[styles.stepperButton, { borderColor: c.input }]}
                            testID={`visit-plus-${line.visitType}`}
                            accessibilityLabel={`One more ${type?.label ?? line.visitType}`}
                          >
                            <Feather name="plus" size={14} color={c.foreground} />
                          </Pressable>
                        </View>
                      )}
                      <Pressable
                        onPress={() => setVisitQuantity(line.visitType, 0)}
                        style={styles.visitLineRemove}
                        testID={`visit-remove-${line.visitType}`}
                        accessibilityLabel={`Remove ${type?.label ?? line.visitType}`}
                      >
                        <Feather name="x" size={16} color={c.mutedForeground} />
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            )}

            {visitTypesLoading && visitTypeOptions.length === 0 ? (
              <View style={[styles.loadingRow, { backgroundColor: c.muted }]}>
                <ActivityIndicator color={c.mutedForeground} />
              </View>
            ) : visitTypeOptions.length === 0 ? (
              <Text style={[styles.helperText, { color: c.mutedForeground }]} testID="text-no-visit-types">
                {hiddenByDiscipline
                  ? `No visit types are set up for ${discipline} yet. Ask Molly to add one.`
                  : 'No visit types are set up yet.'}
              </Text>
            ) : (
              <View style={styles.chipWrap}>
                {visitTypeOptions.map((vt) => (
                  <MultiChip
                    key={vt.key}
                    label={
                      vt.billingUnit === 'increment'
                        ? `${vt.label} (per ${vt.incrementMinutes} min)`
                        : vt.label
                    }
                    selected={visitLines.some((l) => l.visitType === vt.key)}
                    onPress={() => addVisit(vt.key)}
                    testID={`chip-visit-${vt.key}`}
                  />
                ))}
              </View>
            )}
            {totalVisits > 1 && (
              <Text style={[styles.helperText, { color: c.mutedForeground, marginTop: 8 }]}>
                {totalVisits} visits — mileage and per diem attach to the first
              </Text>
            )}
          </>
        ) : (
          <>
            <SectionLabel text="Time in & out" required />
            <View style={styles.timeRow}>
              <TextInput
                value={timeIn}
                onChangeText={(v) => setTimeIn(normalizeTimeInput(v))}
                placeholder="08:22"
                placeholderTextColor={c.mutedForeground}
                keyboardType="numbers-and-punctuation"
                autoCapitalize="none"
                style={[
                  styles.input,
                  styles.timeInput,
                  {
                    backgroundColor: c.card,
                    borderColor: timeIn && !TIME_PATTERN.test(timeIn) ? c.destructive : c.input,
                    color: c.foreground,
                  },
                ]}
                testID="input-time-in"
              />
              <Text style={[styles.timeDash, { color: c.mutedForeground }]}>to</Text>
              <TextInput
                value={timeOut}
                onChangeText={(v) => setTimeOut(normalizeTimeInput(v))}
                placeholder="16:30"
                placeholderTextColor={c.mutedForeground}
                keyboardType="numbers-and-punctuation"
                autoCapitalize="none"
                style={[
                  styles.input,
                  styles.timeInput,
                  {
                    backgroundColor: c.card,
                    borderColor: timeOut && !TIME_PATTERN.test(timeOut) ? c.destructive : c.input,
                    color: c.foreground,
                  },
                ]}
                testID="input-time-out"
              />
            </View>
            {calculatedHours != null ? (
              <Text style={[styles.helperText, { color: c.mutedForeground }]} testID="text-calculated-hours">
                {calculatedHours} hours{overnight ? ' (overnight shift)' : ''}
              </Text>
            ) : (
              <Text style={[styles.helperText, { color: c.mutedForeground }]}>
                Use 24-hour time, like 08:22 or 16:30. Clocked in and out more than
                once? Log each stretch as its own entry — they add up.
              </Text>
            )}
          </>
        )}

        {/* Mileage — only when the client's contract includes it */}
        {mileageAllowed ? (
          <>
            <View style={[styles.switchCard, { backgroundColor: c.card, borderColor: c.border }]}>
              <SwitchRow
                title="Mileage?"
                subtitle={
                  mileageIsRange ? 'Total miles for the period' : 'Round-trip miles for this day'
                }
                value={hasMileage}
                onValueChange={setHasMileage}
                testID="switch-mileage"
              />
            </View>
            {hasMileage ? (
              <TextInput
                value={mileage}
                onChangeText={setMileage}
                placeholder="0"
                placeholderTextColor={c.mutedForeground}
                keyboardType="decimal-pad"
                style={[
                  styles.input,
                  {
                    backgroundColor: c.card,
                    borderColor: mileage && !mileageValid ? c.destructive : c.input,
                    color: c.foreground,
                  },
                ]}
                testID="input-mileage"
              />
            ) : null}
            {/* A mileage total pulled from the client's device covers a period,
                not a day. Only offered for a mileage-only entry — the server
                won't spread a visit or a shift across a range. */}
            {hasMileage && mileageOnly ? (
              <>
                <View style={[styles.switchCard, { backgroundColor: c.card, borderColor: c.border }]}>
                  <SwitchRow
                    title="These miles cover a date range"
                    subtitle="For a mileage report you ran for a whole pay period"
                    value={mileageIsRange}
                    onValueChange={setMileageIsRange}
                    testID="switch-mileage-range"
                  />
                </View>
                {mileageIsRange ? (
                  <>
                    <SectionLabel text="Through" required />
                    <View style={styles.chipWrap}>
                      {dates
                        .filter((d) => d >= date)
                        .map((d) => (
                          <Chip
                            key={d}
                            label={formatPretty(d)}
                            selected={mileageEndDate === d}
                            onPress={() => setMileageEndDate(d)}
                            testID={`chip-mileage-end-${d}`}
                          />
                        ))}
                    </View>
                    <TextInput
                      value={mileageEndDate}
                      onChangeText={setMileageEndDate}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor={c.mutedForeground}
                      autoCapitalize="none"
                      style={[
                        styles.input,
                        {
                          backgroundColor: c.card,
                          borderColor: rangeValid ? c.input : c.destructive,
                          color: c.foreground,
                        },
                      ]}
                      testID="input-mileage-end-date"
                    />
                    <Text style={[styles.helperText, { color: c.mutedForeground }]}>
                      {mileageEndDate && rangeValid
                        ? `One entry covering ${formatPretty(date)} through ${formatPretty(mileageEndDate)}.`
                        : 'Pick or type the last day the report covers.'}
                    </Text>
                  </>
                ) : null}
              </>
            ) : null}
          </>
        ) : selectedClient ? (
          <Text style={[styles.helperText, { color: c.mutedForeground }]} testID="text-no-mileage">
            {selectedClient.name} doesn't include mileage on their contract.
          </Text>
        ) : null}

        {/* Per diem — never applies to Other one-offs */}
        {!isOther && (
          <>
            <SectionLabel text="Per diem" />
            <View style={styles.chipWrap}>
              <Chip label="None" selected={perDiemType === ''} onPress={() => setPerDiemType('')} testID="chip-perdiem-none" />
              <Chip label="First/Last day" selected={perDiemType === 'first_last'} onPress={() => setPerDiemType('first_last')} testID="chip-perdiem-first-last" />
              <Chip label="Full day" selected={perDiemType === 'full'} onPress={() => setPerDiemType('full')} testID="chip-perdiem-full" />
            </View>
          </>
        )}

        {/* Note — the Other section above already collects the description */}
        {!isOther && (
          <>
            <SectionLabel text="Notes (optional)" />
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Anything Molly should know about this shift…"
              placeholderTextColor={c.mutedForeground}
              multiline
              numberOfLines={3}
              style={[
                styles.input,
                styles.noteInput,
                {
                  backgroundColor: c.card,
                  borderColor: c.input,
                  color: c.foreground,
                },
              ]}
              testID="input-note"
            />
          </>
        )}

        {errorMessage ? (
          <View style={[styles.errorBanner, { backgroundColor: '#FBE4E4' }]}>
            <Feather name="alert-circle" size={16} color={c.destructive} />
            <Text style={[styles.errorBannerText, { color: c.destructive }]}>
              {errorMessage}
            </Text>
          </View>
        ) : null}

        {canSaveDraft && (
          <Pressable
            onPress={() => save('draft')}
            disabled={!canSubmit}
            style={({ pressed }) => [
              styles.submitButton,
              styles.draftButton,
              {
                borderColor: c.primary,
                opacity: !canSubmit && !saved ? 0.5 : pressed ? 0.85 : 1,
              },
            ]}
            testID="button-save-draft"
          >
            {isSubmitting && savingAction === 'draft' ? (
              <ActivityIndicator color={c.primary} />
            ) : (
              <>
                <Feather name="edit-3" size={18} color={c.primary} />
                <Text style={[styles.submitText, { color: c.primary }]}>
                  {saved && savingAction === 'draft' ? 'Draft saved!' : 'Save as draft'}
                </Text>
              </>
            )}
          </Pressable>
        )}

        <Pressable
          onPress={() => save('submit')}
          disabled={!canSubmit}
          style={({ pressed }) => [
            styles.submitButton,
            {
              backgroundColor: saved ? c.accent : c.primary,
              opacity: !canSubmit && !saved ? 0.5 : pressed ? 0.85 : 1,
            },
          ]}
          testID="button-submit"
        >
          {isSubmitting && savingAction === 'submit' ? (
            <ActivityIndicator color={c.primaryForeground} />
          ) : saved ? (
            <>
              <Feather name="check" size={18} color={c.accentForeground} />
              <Text style={[styles.submitText, { color: c.accentForeground }]}>
                {submitLabel}
              </Text>
            </>
          ) : (
            <>
              <Feather name="check" size={18} color={c.primaryForeground} />
              <Text style={[styles.submitText, { color: c.primaryForeground }]}>
                {submitLabel}
              </Text>
            </>
          )}
        </Pressable>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

function SectionLabel({ text, required }: { text: string; required?: boolean }) {
  const c = useColors();
  return (
    <Text style={[styles.sectionLabel, { color: c.foreground }]}>
      {text}
      {required ? <Text style={{ color: c.destructive }}> *</Text> : null}
    </Text>
  );
}

/** Single-select chip (client, date, per diem) */
function Chip({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? c.primary : c.card,
          borderColor: selected ? c.primary : c.input,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
      testID={testID}
    >
      <Text
        style={[
          styles.chipText,
          { color: selected ? c.primaryForeground : c.foreground },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Multi-select chip used for visit types — shows a check indicator when
 * selected so it's clear multiple can be active at once.
 */
/** Blocks -> "30 min" / "1 hr 15 min", so employees think in time, not units. */
function formatDuration(blocks: number, minutesPerBlock: number): string {
  const total = blocks * minutesPerBlock;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} hr`;
  return `${hours} hr ${minutes} min`;
}

function MultiChip({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        styles.multiChip,
        {
          backgroundColor: selected ? c.primary : c.card,
          borderColor: selected ? c.primary : c.input,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
      testID={testID}
      aria-pressed={selected}
    >
      {selected && (
        <Feather name="check" size={12} color={c.primaryForeground} style={{ marginRight: 4 }} />
      )}
      <Text
        style={[
          styles.chipText,
          { color: selected ? c.primaryForeground : c.foreground },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function SwitchRow({
  title,
  subtitle,
  value,
  onValueChange,
  testID,
}: {
  title: string;
  subtitle: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  testID?: string;
}) {
  const c = useColors();
  return (
    <View style={styles.switchRow}>
      <View style={{ flex: 1, marginRight: 12 }}>
        <Text style={[styles.switchTitle, { color: c.foreground }]}>{title}</Text>
        <Text style={[styles.switchSubtitle, { color: c.mutedForeground }]}>
          {subtitle}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ true: c.primary }}
        testID={testID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  visitLineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  visitLineLabel: { flex: 1, fontSize: 14, fontWeight: '500' },
  visitLineStepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  visitLineCount: { minWidth: 74, textAlign: 'center', fontSize: 13 },
  visitLineRemove: { padding: 4 },
  stepperButton: {
    width: 28,
    height: 28,
    borderWidth: 1,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  closeButton: {
    width: 32,
    alignItems: 'flex-start',
  },
  headerTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 17,
  },
  content: {
    padding: 20,
  },
  sectionLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    marginTop: 20,
    marginBottom: 8,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
  },
  multiChip: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  chipText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
  },
  segment: {
    flexDirection: 'row',
    borderRadius: colors.radius + 2,
    padding: 3,
  },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 9,
    borderRadius: colors.radius,
  },
  segmentText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  input: {
    borderWidth: 1,
    borderRadius: colors.radius,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
  },
  noteInput: {
    minHeight: 84,
    textAlignVertical: 'top',
  },
  fieldError: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    marginTop: 6,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  timeInput: {
    flex: 1,
  },
  timeDash: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
  },
  helperText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    marginTop: 6,
  },
  loadingRow: {
    height: 48,
    borderRadius: colors.radius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchCard: {
    borderWidth: 1,
    borderRadius: colors.radius + 4,
    paddingHorizontal: 16,
    marginTop: 24,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
  },
  switchDivider: {
    height: StyleSheet.hairlineWidth,
  },
  switchTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
  },
  switchSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    marginTop: 2,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: colors.radius,
    padding: 12,
    marginTop: 20,
  },
  errorBannerText: {
    flex: 1,
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    lineHeight: 18,
  },
  draftButton: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    marginBottom: -12,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 52,
    borderRadius: colors.radius + 4,
    marginTop: 24,
  },
  submitText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
  },
});
