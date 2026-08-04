import React, { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getListTimeEntriesQueryKey,
  useListTimeEntries,
  type TimeEntry,
} from '@workspace/api-client-react';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Redirect, useRouter } from 'expo-router';
import colors from '@/constants/colors';
import { useColors } from '@/hooks/useColors';
import { useEmployee } from '@/lib/employee-context';
import { statusLabels, visitTypeLabels } from '@/lib/labels';

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export default function HomeScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { employee, loading } = useEmployee();
  const [refreshing, setRefreshing] = useState(false);

  const employeeId = employee?.id;
  const {
    data: entries,
    isLoading,
    isError,
    refetch,
  } = useListTimeEntries(
    { employeeId: employeeId ?? '' },
    {
      query: {
        enabled: !!employeeId,
        queryKey: getListTimeEntriesQueryKey({ employeeId: employeeId ?? '' }),
      },
    },
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  const waitingCount = useMemo(
    () => (entries ?? []).filter((e) => e.status === 'submitted').length,
    [entries],
  );

  if (loading) return null;
  if (!employee) return <Redirect href="/select-employee" />;

  const topInset = Platform.OS === 'web' ? 67 : insets.top;
  const bottomInset = Platform.OS === 'web' ? 34 : insets.bottom;

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          {
            paddingTop: topInset + 12,
            backgroundColor: c.card,
            borderBottomColor: c.border,
          },
        ]}
      >
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.headerTitle, { color: c.foreground }]}>
              My Hours
            </Text>
            <Pressable
              onPress={() => router.push('/select-employee')}
              hitSlop={8}
              style={styles.namePill}
              testID="button-switch-employee"
            >
              <Text style={[styles.headerName, { color: c.mutedForeground }]}>
                {employee.name}
              </Text>
              <Feather name="chevron-down" size={14} color={c.mutedForeground} />
            </Pressable>
          </View>
          {waitingCount > 0 && (
            <View style={[styles.countBadge, { backgroundColor: c.accent }]}>
              <Feather name="clock" size={13} color={c.accentForeground} />
              <Text style={[styles.countText, { color: c.accentForeground }]}>
                {waitingCount} waiting
              </Text>
            </View>
          )}
        </View>
      </View>

      <FlatList
        data={entries ?? []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <EntryCard entry={item} />}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: bottomInset + 96 },
        ]}
        scrollEnabled={!!entries && entries.length > 0}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            {isLoading ? (
              <>
                <SkeletonCard />
                <SkeletonCard />
              </>
            ) : isError ? (
              <View style={styles.emptyInner}>
                <Feather name="wifi-off" size={40} color={c.mutedForeground} />
                <Text style={[styles.emptyTitle, { color: c.foreground }]}>
                  Couldn't load your hours
                </Text>
                <Text style={[styles.emptyText, { color: c.mutedForeground }]}>
                  Check your connection and try again.
                </Text>
                <Pressable
                  onPress={() => refetch()}
                  style={[styles.retryButton, { backgroundColor: c.secondary }]}
                  testID="button-retry"
                >
                  <Text
                    style={[styles.retryText, { color: c.secondaryForeground }]}
                  >
                    Try again
                  </Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.emptyInner}>
                <Feather name="file-text" size={40} color={c.mutedForeground} />
                <Text style={[styles.emptyTitle, { color: c.foreground }]}>
                  No hours logged yet
                </Text>
                <Text style={[styles.emptyText, { color: c.mutedForeground }]}>
                  Tap the button below to log your first shift or visit.
                </Text>
              </View>
            )}
          </View>
        }
      />

      {/* Floating log button */}
      <Pressable
        onPress={() => {
          if (Platform.OS !== 'web') {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          }
          router.push('/log-entry');
        }}
        style={({ pressed }) => [
          styles.fab,
          {
            backgroundColor: c.primary,
            bottom: bottomInset + 24,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
        testID="button-log-hours"
      >
        <Feather name="plus" size={22} color={c.primaryForeground} />
        <Text style={[styles.fabText, { color: c.primaryForeground }]}>
          Log Hours
        </Text>
      </Pressable>
    </View>
  );
}

function SkeletonCard() {
  const c = useColors();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: c.card, borderColor: c.border, height: 110 },
      ]}
    />
  );
}

function EntryCard({ entry }: { entry: TimeEntry }) {
  const c = useColors();
  const statusStyle =
    entry.status === 'approved'
      ? { bg: c.accent, fg: c.accentForeground, icon: 'check-circle' as const }
      : entry.status === 'rejected'
        ? { bg: '#FBE4E4', fg: c.destructive, icon: 'x-circle' as const }
        : { bg: c.muted, fg: c.mutedForeground, icon: 'clock' as const };

  return (
    <View
      style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}
      testID={`entry-${entry.id}`}
    >
      <View style={styles.cardTop}>
        <View style={{ flex: 1, marginRight: 8 }}>
          <Text
            style={[styles.cardClient, { color: c.foreground }]}
            numberOfLines={1}
          >
            {entry.clientName}
          </Text>
          <Text style={[styles.cardDate, { color: c.mutedForeground }]}>
            {formatDate(entry.date)}
          </Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: statusStyle.bg }]}>
          <Feather name={statusStyle.icon} size={12} color={statusStyle.fg} />
          <Text style={[styles.statusText, { color: statusStyle.fg }]}>
            {statusLabels[entry.status]}
          </Text>
        </View>
      </View>

      <View style={styles.cardDetails}>
        {entry.visitType && (
          <Detail icon="activity" text={visitTypeLabels[entry.visitType]} />
        )}
        {entry.hours != null && entry.hours > 0 && (
          <Detail icon="clock" text={`${entry.hours} hrs`} />
        )}
        {entry.mileage != null && entry.mileage > 0 && (
          <Detail icon="map-pin" text={`${entry.mileage} mi`} />
        )}
        {entry.perDiem != null && entry.perDiem > 0 && (
          <Detail
            icon="sun"
            text={entry.perDiem === 1 ? 'Full day per diem' : 'Half day per diem'}
          />
        )}
        {entry.isWeekend && <Detail icon="calendar" text="Weekend" />}
        {entry.isHoliday && <Detail icon="star" text="Holiday" />}
      </View>

      {entry.note ? (
        <Text
          style={[styles.cardNote, { color: c.mutedForeground, borderTopColor: c.border }]}
          numberOfLines={2}
        >
          {entry.note}
        </Text>
      ) : null}
    </View>
  );
}

function Detail({
  icon,
  text,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  text: string;
}) {
  const c = useColors();
  return (
    <View style={[styles.detailChip, { backgroundColor: c.muted }]}>
      <Feather name={icon} size={12} color={c.mutedForeground} />
      <Text style={[styles.detailText, { color: c.foreground }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 24,
  },
  namePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
    alignSelf: 'flex-start',
  },
  headerName: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
  },
  countBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  countText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
  },
  listContent: {
    padding: 16,
    gap: 12,
  },
  card: {
    borderRadius: colors.radius + 4,
    borderWidth: 1,
    padding: 16,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  cardClient: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
  },
  cardDate: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    marginTop: 2,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
  },
  statusText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
  },
  cardDetails: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 12,
  },
  detailChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
  },
  detailText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
  },
  cardNote: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    fontStyle: 'italic',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  emptyWrap: {
    gap: 12,
  },
  emptyInner: {
    alignItems: 'center',
    paddingVertical: 64,
    paddingHorizontal: 24,
    gap: 8,
  },
  emptyTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 17,
    marginTop: 8,
  },
  emptyText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  retryButton: {
    marginTop: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: colors.radius,
  },
  retryText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  fab: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
    height: 52,
    borderRadius: 999,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  fabText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
  },
});
