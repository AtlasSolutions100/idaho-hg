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
  ApiError,
  getGetMyEmployeeQueryKey,
  getListClaimableEmployeesQueryKey,
  getListTimeEntriesQueryKey,
  useCancelMyLinkRequest,
  useGetMyEmployee,
  useListTimeEntries,
  type TimeEntry,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth, useClerk } from '@clerk/expo';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Redirect, useRouter } from 'expo-router';
import { ClaimProfile } from '@/components/ClaimProfile';
import colors from '@/constants/colors';
import { useColors } from '@/hooks/useColors';
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
  const { isLoaded, isSignedIn } = useAuth();
  const { signOut } = useClerk();
  const [refreshing, setRefreshing] = useState(false);

  // Who am I? The server maps the signed-in email to the roster.
  const {
    data: employee,
    isLoading: meLoading,
    error: meError,
    refetch: refetchMe,
  } = useGetMyEmployee({
    query: {
      enabled: isLoaded && isSignedIn,
      retry: false,
      queryKey: getGetMyEmployeeQueryKey(),
    },
  });

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

  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect href="/sign-in" />;

  const topInset = Platform.OS === 'web' ? 67 : insets.top;
  const bottomInset = Platform.OS === 'web' ? 34 : insets.bottom;

  // Signed in, but the server won't let this email in — the email isn't
  // linked to a profile yet, a link request is waiting on Molly, or Molly
  // turned this employee's sign-in off. Branch on the stable error code.
  if (meError instanceof ApiError && meError.response.status === 403) {
    const errorCode =
      !!meError.data && typeof meError.data === 'object'
        ? (meError.data as { code?: unknown }).code
        : undefined;
    if (errorCode === 'NOT_LINKED') {
      // Pick-your-name flow: claim a roster profile; Molly approves it.
      return <ClaimProfile onSignOut={() => signOut()} />;
    }
    if (errorCode === 'LINK_REQUEST_PENDING') {
      return <WaitingForApproval onSignOut={() => signOut()} onCheckAgain={() => refetchMe()} />;
    }
    const signInTurnedOff = errorCode === 'SIGN_IN_DISABLED';
    return (
      <View
        style={[
          styles.container,
          {
            backgroundColor: c.background,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 32,
          },
        ]}
      >
        <Feather
          name={signInTurnedOff ? 'lock' : 'user-x'}
          size={44}
          color={c.mutedForeground}
        />
        <Text style={[styles.emptyTitle, { color: c.foreground, textAlign: 'center' }]}>
          {signInTurnedOff ? 'Your sign-in is turned off' : "You're not on the roster yet"}
        </Text>
        <Text style={[styles.emptyText, { color: c.mutedForeground }]}>
          {signInTurnedOff
            ? 'Molly turned off app access for this email. Ask her if you think this is a mistake.'
            : 'Ask Molly to add this email to the team roster, then try again.'}
        </Text>
        <Pressable
          onPress={() => refetchMe()}
          style={[styles.retryButton, { backgroundColor: c.primary }]}
          testID="button-check-again"
        >
          <Text style={[styles.retryText, { color: c.primaryForeground }]}>
            Check again
          </Text>
        </Pressable>
        <Pressable
          onPress={() => signOut()}
          style={[styles.retryButton, { backgroundColor: c.secondary }]}
          testID="button-sign-out"
        >
          <Text style={[styles.retryText, { color: c.secondaryForeground }]}>
            Sign out
          </Text>
        </Pressable>
      </View>
    );
  }

  if (meLoading || (!employee && !meError)) {
    return (
      <View
        style={[
          styles.container,
          { backgroundColor: c.background, alignItems: 'center', justifyContent: 'center' },
        ]}
      >
        <Text style={[styles.emptyText, { color: c.mutedForeground }]}>
          Loading…
        </Text>
      </View>
    );
  }

  if (!employee) {
    return (
      <View
        style={[
          styles.container,
          {
            backgroundColor: c.background,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 32,
          },
        ]}
      >
        <Feather name="wifi-off" size={40} color={c.mutedForeground} />
        <Text style={[styles.emptyTitle, { color: c.foreground }]}>
          Couldn't load your info
        </Text>
        <Pressable
          onPress={() => refetchMe()}
          style={[styles.retryButton, { backgroundColor: c.secondary }]}
          testID="button-retry-me"
        >
          <Text style={[styles.retryText, { color: c.secondaryForeground }]}>
            Try again
          </Text>
        </Pressable>
      </View>
    );
  }

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
              onPress={() => signOut()}
              hitSlop={8}
              style={styles.namePill}
              testID="button-sign-out"
            >
              <Text style={[styles.headerName, { color: c.mutedForeground }]}>
                {employee.name} · Sign out
              </Text>
              <Feather name="log-out" size={13} color={c.mutedForeground} />
            </Pressable>
          </View>
          <Pressable
            onPress={() => router.push('/profile')}
            hitSlop={8}
            style={[styles.profileButton, { backgroundColor: c.secondary }]}
            testID="button-my-info"
          >
            <Feather name="user" size={15} color={c.secondaryForeground} />
            <Text style={[styles.profileButtonText, { color: c.secondaryForeground }]}>
              My Info
            </Text>
          </Pressable>
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

/**
 * "Waiting for Molly to confirm" screen. Besides checking again, the person
 * can cancel their own pending request ("That's not me — pick again") and
 * return to the name list — no need for Molly to deny a mistaken pick.
 */
function WaitingForApproval({
  onSignOut,
  onCheckAgain,
}: {
  onSignOut: () => void;
  onCheckAgain: () => void;
}) {
  const c = useColors();
  const queryClient = useQueryClient();
  const [cancelError, setCancelError] = useState<string | null>(null);

  const cancelMutation = useCancelMyLinkRequest({
    mutation: {
      onSuccess: () => {
        // /me now returns NOT_LINKED, which brings back the name list.
        queryClient.invalidateQueries({ queryKey: getListClaimableEmployeesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetMyEmployeeQueryKey() });
      },
      onError: (error) => {
        // 404 means Molly already handled it — refetch /me to land on the
        // right screen instead of showing a scary error.
        if (error instanceof ApiError && error.response.status === 404) {
          queryClient.invalidateQueries({ queryKey: getGetMyEmployeeQueryKey() });
          return;
        }
        setCancelError("Couldn't cancel that. Check your connection and try again.");
      },
    },
  });

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: c.background,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 32,
        },
      ]}
    >
      <Feather name="clock" size={44} color={c.mutedForeground} />
      <Text style={[styles.emptyTitle, { color: c.foreground, textAlign: 'center' }]}>
        Waiting for Molly to confirm
      </Text>
      <Text style={[styles.emptyText, { color: c.mutedForeground }]}>
        You asked to link this email to your profile. Once Molly confirms
        it's you, you're in — check back in a bit.
      </Text>
      {cancelError ? (
        <Text style={[styles.emptyText, { color: c.destructive }]}>{cancelError}</Text>
      ) : null}
      <Pressable
        onPress={onCheckAgain}
        style={[styles.retryButton, { backgroundColor: c.primary }]}
        testID="button-check-again"
      >
        <Text style={[styles.retryText, { color: c.primaryForeground }]}>
          Check again
        </Text>
      </Pressable>
      <Pressable
        onPress={() => {
          setCancelError(null);
          cancelMutation.mutate();
        }}
        disabled={cancelMutation.isPending}
        style={[
          styles.retryButton,
          { backgroundColor: c.secondary, opacity: cancelMutation.isPending ? 0.5 : 1 },
        ]}
        testID="button-cancel-claim"
      >
        <Text style={[styles.retryText, { color: c.secondaryForeground }]}>
          {cancelMutation.isPending ? 'Cancelling…' : "That's not me — pick again"}
        </Text>
      </Pressable>
      <Pressable
        onPress={onSignOut}
        style={[styles.retryButton, { backgroundColor: c.secondary }]}
        testID="button-sign-out"
      >
        <Text style={[styles.retryText, { color: c.secondaryForeground }]}>
          Sign out
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
  const router = useRouter();
  const statusStyle =
    entry.status === 'approved'
      ? { bg: c.accent, fg: c.accentForeground, icon: 'check-circle' as const }
      : entry.status === 'rejected'
        ? { bg: '#FBE4E4', fg: c.destructive, icon: 'x-circle' as const }
        : entry.status === 'draft'
          ? { bg: c.card, fg: c.mutedForeground, icon: 'edit-3' as const }
          : { bg: c.muted, fg: c.mutedForeground, icon: 'clock' as const };

  // Anything Molly hasn't approved yet can still be opened and edited.
  const editable = entry.status !== 'approved';

  return (
    <Pressable
      onPress={
        editable
          ? () => router.push({ pathname: '/log-entry', params: { id: entry.id } })
          : undefined
      }
      disabled={!editable}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: c.card,
          borderColor: entry.status === 'draft' ? c.mutedForeground : c.border,
          borderStyle: entry.status === 'draft' ? 'dashed' : 'solid',
          opacity: pressed ? 0.85 : 1,
        },
      ]}
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
        {editable ? (
          <Feather
            name="chevron-right"
            size={16}
            color={c.mutedForeground}
            style={{ marginLeft: 6, alignSelf: 'center' }}
          />
        ) : (
          <Feather
            name="lock"
            size={13}
            color={c.mutedForeground}
            style={{ marginLeft: 6, alignSelf: 'center' }}
            testID={`locked-${entry.id}`}
          />
        )}
      </View>

      <View style={styles.cardDetails}>
        {entry.visitType && (
          <Detail icon="activity" text={visitTypeLabels[entry.visitType]} />
        )}
        {entry.hours != null && entry.hours > 0 && (
          <Detail
            icon="clock"
            text={
              entry.timeIn && entry.timeOut
                ? `${entry.hours} hrs (${entry.timeIn}–${entry.timeOut})`
                : `${entry.hours} hrs`
            }
          />
        )}
        {entry.mileage != null && entry.mileage > 0 && (
          <Detail icon="map-pin" text={`${entry.mileage} mi`} />
        )}
        {entry.perDiem != null && entry.perDiem > 0 && (
          <Detail
            icon="sun"
            text={
              entry.perDiemType === 'first_last'
                ? 'First/Last day per diem'
                : entry.perDiemType === 'full' || entry.perDiem === 1
                  ? 'Full day per diem'
                  : 'Half day per diem'
            }
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
    </Pressable>
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
  profileButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    marginLeft: 8,
  },
  profileButtonText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
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
