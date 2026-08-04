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
  useCreateTimeEntry,
  useListClients,
  type VisitType,
} from '@workspace/api-client-react';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Redirect, useRouter } from 'expo-router';
import colors from '@/constants/colors';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useColors } from '@/hooks/useColors';
import { useEmployee } from '@/lib/employee-context';
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
  const { employee } = useEmployee();

  const [entryType, setEntryType] = useState<'visit' | 'hourly'>('visit');
  const [clientId, setClientId] = useState('');
  const [visitType, setVisitType] = useState<VisitType | ''>('');
  const [hours, setHours] = useState('');
  const [date, setDate] = useState(toDateString(new Date()));
  const [mileage, setMileage] = useState('');
  const [perDiem, setPerDiem] = useState<0 | 0.5 | 1>(0);
  const [isWeekend, setIsWeekend] = useState(false);
  const [isHoliday, setIsHoliday] = useState(false);
  const [note, setNote] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dates = useMemo(recentDates, []);
  const { data: clients, isLoading: clientsLoading } = useListClients();

  const createEntry = useCreateTimeEntry({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getListTimeEntriesQueryKey(),
        });
        if (Platform.OS !== 'web') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        setSaved(true);
        setTimeout(() => router.back(), 900);
      },
      onError: (error) => {
        setErrorMessage(
          error?.message ??
            "We couldn't save your hours. Please check your connection and try again.",
        );
      },
    },
  });

  const hoursNumber = parseFloat(hours);
  const hoursValid =
    entryType !== 'hourly' ||
    (!Number.isNaN(hoursNumber) && hoursNumber > 0 && hoursNumber <= 24);
  const mileageNumber = mileage ? parseFloat(mileage) : 0;
  const mileageValid = !mileage || (!Number.isNaN(mileageNumber) && mileageNumber >= 0);
  const canSubmit =
    !!employee &&
    !!clientId &&
    !!date &&
    (entryType === 'visit' ? !!visitType : hoursValid) &&
    mileageValid &&
    !createEntry.isPending &&
    !saved;

  if (!employee) return <Redirect href="/select-employee" />;

  const handleSubmit = () => {
    if (!canSubmit || !employee) return;
    setErrorMessage(null);
    createEntry.mutate({
      data: {
        employeeId: employee.id,
        clientId,
        date,
        ...(entryType === 'visit' && visitType ? { visitType } : {}),
        ...(entryType === 'hourly' && hoursValid ? { hours: hoursNumber } : {}),
        ...(mileage && mileageNumber > 0 ? { mileage: mileageNumber } : {}),
        ...(perDiem > 0 ? { perDiem } : {}),
        isWeekend,
        isHoliday,
        ...(note.trim() ? { note: note.trim() } : {}),
      },
    });
  };

  const topInset = Platform.OS === 'web' ? 67 : Math.max(insets.top, 12);
  const bottomInset = Platform.OS === 'web' ? 34 : insets.bottom;

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
                onPress={() => setClientId(client.id)}
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

        {/* Visit vs hourly */}
        <SectionLabel text="What are you logging?" />
        <View style={[styles.segment, { backgroundColor: c.muted }]}>
          {(['visit', 'hourly'] as const).map((t) => (
            <Pressable
              key={t}
              onPress={() => setEntryType(t)}
              style={[
                styles.segmentItem,
                entryType === t && {
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
                    color: entryType === t ? c.foreground : c.mutedForeground,
                  },
                ]}
              >
                {t === 'visit' ? 'A visit' : 'Hourly work'}
              </Text>
            </Pressable>
          ))}
        </View>

        {entryType === 'visit' ? (
          <>
            <SectionLabel text="Visit type" required />
            <View style={styles.chipWrap}>
              {(Object.keys(visitTypeLabels) as VisitType[]).map((t) => (
                <Chip
                  key={t}
                  label={visitTypeLabels[t]}
                  selected={visitType === t}
                  onPress={() => setVisitType(t)}
                  testID={`chip-visit-${t}`}
                />
              ))}
            </View>
          </>
        ) : (
          <>
            <SectionLabel text="Hours worked" required />
            <TextInput
              value={hours}
              onChangeText={setHours}
              placeholder="8"
              placeholderTextColor={c.mutedForeground}
              keyboardType="decimal-pad"
              style={[
                styles.input,
                {
                  backgroundColor: c.card,
                  borderColor: hours && !hoursValid ? c.destructive : c.input,
                  color: c.foreground,
                },
              ]}
              testID="input-hours"
            />
            {hours && !hoursValid ? (
              <Text style={[styles.fieldError, { color: c.destructive }]}>
                Hours should be between 0 and 24.
              </Text>
            ) : null}
          </>
        )}

        {/* Mileage */}
        <SectionLabel text="Mileage (round trip)" />
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

        {/* Per diem */}
        <SectionLabel text="Per diem" />
        <View style={styles.chipWrap}>
          <Chip label="None" selected={perDiem === 0} onPress={() => setPerDiem(0)} testID="chip-perdiem-0" />
          <Chip label="Half day" selected={perDiem === 0.5} onPress={() => setPerDiem(0.5)} testID="chip-perdiem-half" />
          <Chip label="Full day" selected={perDiem === 1} onPress={() => setPerDiem(1)} testID="chip-perdiem-full" />
        </View>

        {/* Weekend / holiday */}
        <View style={[styles.switchCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <SwitchRow
            title="Weekend"
            subtitle="This was weekend work (1.5x pay)"
            value={isWeekend}
            onValueChange={setIsWeekend}
            testID="switch-weekend"
          />
          <View style={[styles.switchDivider, { backgroundColor: c.border }]} />
          <SwitchRow
            title="Holiday"
            subtitle="This was holiday work (2x pay)"
            value={isHoliday}
            onValueChange={setIsHoliday}
            testID="switch-holiday"
          />
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
          {createEntry.isPending ? (
            <ActivityIndicator color={c.primaryForeground} />
          ) : saved ? (
            <>
              <Feather name="check" size={18} color={c.accentForeground} />
              <Text style={[styles.submitText, { color: c.accentForeground }]}>
                Submitted!
              </Text>
            </>
          ) : (
            <>
              <Feather name="check" size={18} color={c.primaryForeground} />
              <Text style={[styles.submitText, { color: c.primaryForeground }]}>
                Submit Hours
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
