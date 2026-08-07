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
  useBatchCreateTimeEntries,
  useCreateTimeEntry,
  useGetMyEmployee,
  useListClients,
  type PerDiemType,
  type VisitType,
} from '@workspace/api-client-react';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Redirect, useRouter } from 'expo-router';
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

export default function LogEntryScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  // Server derives the employee from the signed-in session; we only need it
  // here to know the form is ready to submit.
  const { data: employee } = useGetMyEmployee();

  const [entryType, setEntryType] = useState<'visit' | 'hourly'>('visit');
  const [clientId, setClientId] = useState('');
  // Multi-visit: a set of selected visit types
  const [selectedVisitTypes, setSelectedVisitTypes] = useState<Set<VisitType>>(new Set());
  const [timeIn, setTimeIn] = useState('');
  const [timeOut, setTimeOut] = useState('');
  const [date, setDate] = useState(toDateString(new Date()));
  const [hasMileage, setHasMileage] = useState(false);
  const [mileage, setMileage] = useState('');
  const [perDiemType, setPerDiemType] = useState<PerDiemType | ''>('');
  const [note, setNote] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const dates = useMemo(recentDates, []);
  const { data: clients, isLoading: clientsLoading } = useListClients();

  const createEntry = useCreateTimeEntry();
  const batchCreateEntries = useBatchCreateTimeEntries();

  const selectedClient = (clients ?? []).find((cl) => cl.id === clientId);
  // Clients whose contract doesn't include mileage never see the toggle.
  const mileageAllowed = selectedClient ? selectedClient.mileageOnContract : true;
  // Visit types only apply to clients that bill by visit type (St. Luke's);
  // everyone else gets the simple time-in/time-out form.
  const billsByVisit = selectedClient?.billsByVisitType ?? false;
  const effectiveEntryType: 'visit' | 'hourly' = billsByVisit ? entryType : 'hourly';
  const calculatedHours = useMemo(() => calculateHours(timeIn, timeOut), [timeIn, timeOut]);
  const overnight = calculatedHours != null && timeIn >= timeOut;
  const timesValid = effectiveEntryType !== 'hourly' || calculatedHours != null;
  const mileageNumber = mileage ? parseFloat(mileage) : 0;
  const mileageValid =
    !hasMileage || !mileage || (!Number.isNaN(mileageNumber) && mileageNumber >= 0);
  const canSubmit =
    !!employee &&
    !!clientId &&
    !!date &&
    (effectiveEntryType === 'visit' ? selectedVisitTypes.size > 0 : timesValid) &&
    mileageValid &&
    !isSubmitting &&
    !saved;

  const toggleVisitType = (vt: VisitType) => {
    setSelectedVisitTypes((prev) => {
      const next = new Set(prev);
      if (next.has(vt)) {
        next.delete(vt);
      } else {
        next.add(vt);
      }
      return next;
    });
  };

  if (!employee) return <Redirect href="/sign-in" />;

  const handleSubmit = async () => {
    if (!canSubmit || !employee) return;
    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      if (effectiveEntryType === 'visit') {
        // Single atomic batch request — all visit types in one transaction.
        // If anything fails the whole batch rolls back; no partial state.
        await batchCreateEntries.mutateAsync({
          data: {
            employeeId: employee.id,
            clientId,
            date,
            visitTypes: [...selectedVisitTypes],
            ...(mileageAllowed && hasMileage && mileageNumber > 0
              ? { mileage: mileageNumber }
              : {}),
            ...(perDiemType ? { perDiemType } : {}),
            ...(note.trim() ? { note: note.trim() } : {}),
          },
        });
      } else {
        await createEntry.mutateAsync({
          data: {
            employeeId: employee.id,
            clientId,
            date,
            ...(timesValid ? { timeIn, timeOut } : {}),
            ...(mileageAllowed && hasMileage && mileageNumber > 0
              ? { mileage: mileageNumber }
              : {}),
            ...(perDiemType ? { perDiemType } : {}),
            ...(note.trim() ? { note: note.trim() } : {}),
          },
        });
      }

      queryClient.invalidateQueries({ queryKey: getListTimeEntriesQueryKey() });
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      setSaved(true);
      setTimeout(() => router.back(), 900);
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

  const submitLabel = saved
    ? 'Submitted!'
    : isSubmitting
      ? 'Submitting…'
      : effectiveEntryType === 'visit' && selectedVisitTypes.size > 1
        ? `Submit ${selectedVisitTypes.size} Visits`
        : 'Submit Hours';

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
          Log Hours
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
                  setSelectedVisitTypes(new Set());
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

        {/* Visit vs hourly — only clients that bill by visit type (St. Luke's)
            get the choice; everyone else logs time in/out. */}
        {billsByVisit && (
          <>
        <SectionLabel text="What are you logging?" />
        <View style={[styles.segment, { backgroundColor: c.muted }]}>
          {(['visit', 'hourly'] as const).map((t) => (
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
                {t === 'visit' ? 'A visit' : 'Hourly work'}
              </Text>
            </Pressable>
          ))}
        </View>
          </>
        )}

        {effectiveEntryType === 'visit' ? (
          <>
            <SectionLabel text="Visit type(s)" required />
            <Text style={[styles.helperText, { color: c.mutedForeground, marginTop: 0, marginBottom: 8 }]}>
              Tap to select — you can pick more than one for the same day
            </Text>
            <View style={styles.chipWrap}>
              {(Object.keys(visitTypeLabels) as VisitType[]).map((t) => (
                <MultiChip
                  key={t}
                  label={visitTypeLabels[t]}
                  selected={selectedVisitTypes.has(t)}
                  onPress={() => toggleVisitType(t)}
                  testID={`chip-visit-${t}`}
                />
              ))}
            </View>
            {selectedVisitTypes.size > 1 && (
              <Text style={[styles.helperText, { color: c.mutedForeground, marginTop: 8 }]}>
                {selectedVisitTypes.size} visits selected — mileage and per diem attach to the first
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
                subtitle="Round-trip miles for this day"
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
          </>
        ) : selectedClient ? (
          <Text style={[styles.helperText, { color: c.mutedForeground }]} testID="text-no-mileage">
            {selectedClient.name} doesn't include mileage on their contract.
          </Text>
        ) : null}

        {/* Per diem */}
        <SectionLabel text="Per diem" />
        <View style={styles.chipWrap}>
          <Chip label="None" selected={perDiemType === ''} onPress={() => setPerDiemType('')} testID="chip-perdiem-none" />
          <Chip label="First/Last day" selected={perDiemType === 'first_last'} onPress={() => setPerDiemType('first_last')} testID="chip-perdiem-first-last" />
          <Chip label="Full day" selected={perDiemType === 'full'} onPress={() => setPerDiemType('full')} testID="chip-perdiem-full" />
        </View>

        {/* Note */}
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

        {errorMessage ? (
          <View style={[styles.errorBanner, { backgroundColor: '#FBE4E4' }]}>
            <Feather name="alert-circle" size={16} color={c.destructive} />
            <Text style={[styles.errorBannerText, { color: c.destructive }]}>
              {errorMessage}
            </Text>
          </View>
        ) : null}

        <Pressable
          onPress={handleSubmit}
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
          {isSubmitting ? (
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
