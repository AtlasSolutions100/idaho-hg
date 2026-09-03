import React, { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetMyEmployeeQueryKey,
  getListClaimableEmployeesQueryKey,
  useCreateLinkRequest,
  useListClaimableEmployees,
  useListDisciplines,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';

/**
 * Shown when a signed-in email isn't linked to a roster profile yet.
 * The person picks their name and confirms their discipline; Molly approves
 * both from her admin page.
 *
 * The discipline is confirmed here rather than assumed from the roster because
 * it decides which visit types they'll be offered and what they're paid — and
 * the person themselves is the one who knows it. It is only a claim until
 * Molly approves: approving applies it, denying discards it.
 */
export function ClaimProfile({ onSignOut }: { onSignOut: () => void }) {
  const c = useColors();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [discipline, setDiscipline] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    data: claimable,
    isLoading,
    isError,
    refetch,
  } = useListClaimableEmployees({
    query: { queryKey: getListClaimableEmployeesQueryKey() },
  });

  const { data: disciplines } = useListDisciplines();
  const activeDisciplines = (disciplines ?? []).filter((d) => d.active);
  const selectedEmployee = (claimable ?? []).find((e) => e.id === selectedId);

  const claimMutation = useCreateLinkRequest({
    mutation: {
      onSuccess: () => {
        // /me now returns the "waiting for Molly" state.
        queryClient.invalidateQueries({ queryKey: getGetMyEmployeeQueryKey() });
      },
      onError: (error) => {
        const message =
          error &&
          typeof error === 'object' &&
          'data' in error &&
          error.data &&
          typeof error.data === 'object' &&
          'message' in error.data &&
          typeof (error.data as { message?: unknown }).message === 'string'
            ? (error.data as { message: string }).message
            : "Couldn't send that. Check your connection and try again.";
        setSubmitError(message);
        queryClient.invalidateQueries({ queryKey: getListClaimableEmployeesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetMyEmployeeQueryKey() });
      },
    },
  });

  const submit = () => {
    if (!selectedId) return;
    setSubmitError(null);
    claimMutation.mutate({
      data: {
        employeeId: selectedId,
        ...(discipline ? { discipline } : {}),
      },
    });
  };

  // Picking a name pre-selects whatever discipline the roster already has, so
  // the common case is confirm-and-go rather than another decision.
  const pickEmployee = (id: string) => {
    setSelectedId(id);
    const emp = (claimable ?? []).find((e) => e.id === id);
    setDiscipline(emp?.role || null);
  };

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <View style={styles.header}>
        <Feather name="user-plus" size={40} color={c.mutedForeground} />
        <Text style={[styles.title, { color: c.foreground }]}>Which one are you?</Text>
        <Text style={[styles.subtitle, { color: c.mutedForeground }]}>
          Pick your name and Molly will confirm it's you. After that you're all
          set — no need to ask her to type in your email.
        </Text>
      </View>

      {isLoading ? (
        <Text style={[styles.subtitle, { color: c.mutedForeground }]}>Loading names…</Text>
      ) : isError ? (
        <View style={styles.center}>
          <Text style={[styles.subtitle, { color: c.mutedForeground }]}>
            Couldn't load the team list.
          </Text>
          <Pressable
            onPress={() => refetch()}
            style={[styles.button, { backgroundColor: c.secondary }]}
            testID="button-retry-claimable"
          >
            <Text style={[styles.buttonText, { color: c.secondaryForeground }]}>Try again</Text>
          </Pressable>
        </View>
      ) : (claimable ?? []).length === 0 ? (
        <View style={styles.center}>
          <Text style={[styles.subtitle, { color: c.mutedForeground }]}>
            There's no open profile to claim right now. Ask Molly to add you to
            the team, then try again.
          </Text>
          <Pressable
            onPress={() => refetch()}
            style={[styles.button, { backgroundColor: c.secondary }]}
            testID="button-refresh-claimable"
          >
            <Text style={[styles.buttonText, { color: c.secondaryForeground }]}>Check again</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={claimable ?? []}
          keyExtractor={(item) => item.id}
          style={styles.list}
          contentContainerStyle={{ gap: 8, paddingBottom: 16 }}
          renderItem={({ item }) => {
            const selected = item.id === selectedId;
            return (
              <Pressable
                onPress={() => pickEmployee(item.id)}
                style={[
                  styles.row,
                  {
                    backgroundColor: c.card,
                    borderColor: selected ? c.primary : c.border,
                    borderWidth: selected ? 2 : 1,
                  },
                ]}
                testID={`claim-employee-${item.id}`}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowName, { color: c.foreground }]}>{item.name}</Text>
                  <Text style={[styles.rowRole, { color: c.mutedForeground }]}>{item.role}</Text>
                </View>
                {selected && <Feather name="check-circle" size={20} color={c.primary} />}
              </Pressable>
            );
          }}
        />
      )}

      {selectedEmployee && activeDisciplines.length > 0 ? (
        <View style={styles.disciplineBlock}>
          <Text style={[styles.disciplineLabel, { color: c.foreground }]}>
            And your profession?
          </Text>
          <View style={styles.disciplineWrap}>
            {activeDisciplines.map((d) => {
              const on = discipline === d.key;
              return (
                <Pressable
                  key={d.key}
                  onPress={() => setDiscipline(d.key)}
                  style={[
                    styles.disciplineChip,
                    {
                      backgroundColor: on ? c.primary : c.card,
                      borderColor: on ? c.primary : c.input,
                    },
                  ]}
                  testID={`claim-discipline-${d.key}`}
                  aria-pressed={on}
                >
                  <Text
                    style={[
                      styles.disciplineChipText,
                      { color: on ? c.primaryForeground : c.foreground },
                    ]}
                  >
                    {d.key}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {submitError ? (
        <Text style={[styles.error, { color: c.destructive }]}>{submitError}</Text>
      ) : null}

      <Pressable
        onPress={submit}
        disabled={!selectedId || claimMutation.isPending}
        style={[
          styles.button,
          {
            backgroundColor: c.primary,
            opacity: !selectedId || claimMutation.isPending ? 0.5 : 1,
          },
        ]}
        testID="button-submit-claim"
      >
        <Text style={[styles.buttonText, { color: c.primaryForeground }]}>
          {claimMutation.isPending ? 'Sending…' : "That's me"}
        </Text>
      </Pressable>
      <Pressable
        onPress={onSignOut}
        style={[styles.button, { backgroundColor: c.secondary }]}
        testID="button-sign-out"
      >
        <Text style={[styles.buttonText, { color: c.secondaryForeground }]}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 80,
    paddingBottom: 40,
  },
  header: { alignItems: 'center', gap: 8, marginBottom: 20 },
  center: { alignItems: 'center', gap: 12 },
  title: {
    fontFamily: 'Inter_700Bold',
    fontSize: 22,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  list: { flexGrow: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
  },
  disciplineBlock: { gap: 8, marginTop: 4, marginBottom: 4 },
  disciplineLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  disciplineWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  disciplineChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
  },
  disciplineChipText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  rowName: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  rowRole: { fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: 1 },
  error: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 8,
  },
  button: {
    alignItems: 'center',
    paddingVertical: 13,
    borderRadius: 12,
    marginTop: 8,
  },
  buttonText: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
});
