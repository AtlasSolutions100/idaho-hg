import React from 'react';
import {
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useListEmployees, type Employee } from '@workspace/api-client-react';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import colors from '@/constants/colors';
import { useColors } from '@/hooks/useColors';
import { useEmployee } from '@/lib/employee-context';

export default function SelectEmployeeScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { employee: current, selectEmployee } = useEmployee();
  const { data: employees, isLoading, isError, refetch } = useListEmployees();

  const handlePick = async (emp: Employee) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    await selectEmployee({ id: emp.id, name: emp.name, role: emp.role });
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  };

  const topInset = Platform.OS === 'web' ? 67 : insets.top;
  const bottomInset = Platform.OS === 'web' ? 34 : insets.bottom;

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <View style={[styles.header, { paddingTop: topInset + 16 }]}>
        <Text style={[styles.title, { color: c.foreground }]}>
          Who are you?
        </Text>
        <Text style={[styles.subtitle, { color: c.mutedForeground }]}>
          Pick your name so your hours go on the right timesheet. You can
          switch any time.
        </Text>
      </View>

      {isLoading ? (
        <View style={styles.centerWrap}>
          {[0, 1, 2, 3, 4].map((i) => (
            <View
              key={i}
              style={[
                styles.row,
                { backgroundColor: c.card, borderColor: c.border, height: 64 },
              ]}
            />
          ))}
        </View>
      ) : isError ? (
        <View style={styles.errorWrap}>
          <Feather name="wifi-off" size={40} color={c.mutedForeground} />
          <Text style={[styles.errorTitle, { color: c.foreground }]}>
            Couldn't load the team list
          </Text>
          <Text style={[styles.errorText, { color: c.mutedForeground }]}>
            Check your connection and try again.
          </Text>
          <Pressable
            onPress={() => refetch()}
            style={[styles.retryButton, { backgroundColor: c.primary }]}
            testID="button-retry-employees"
          >
            <Text style={[styles.retryText, { color: c.primaryForeground }]}>
              Try again
            </Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={employees ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: bottomInset + 24 },
          ]}
          scrollEnabled={!!employees && employees.length > 0}
          renderItem={({ item }) => {
            const selected = current?.id === item.id;
            return (
              <Pressable
                onPress={() => handlePick(item)}
                style={({ pressed }) => [
                  styles.row,
                  {
                    backgroundColor: selected ? c.accent : c.card,
                    borderColor: selected ? c.primary : c.border,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
                testID={`employee-${item.id}`}
              >
                <View
                  style={[
                    styles.avatar,
                    { backgroundColor: selected ? c.primary : c.muted },
                  ]}
                >
                  <Text
                    style={[
                      styles.avatarText,
                      {
                        color: selected
                          ? c.primaryForeground
                          : c.mutedForeground,
                      },
                    ]}
                  >
                    {item.name
                      .split(' ')
                      .map((p) => p[0])
                      .slice(0, 2)
                      .join('')}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowName, { color: c.foreground }]}>
                    {item.name}
                  </Text>
                  <Text style={[styles.rowRole, { color: c.mutedForeground }]}>
                    {item.role}
                  </Text>
                </View>
                {selected && (
                  <Feather name="check" size={20} color={c.primary} />
                )}
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  title: {
    fontFamily: 'Inter_700Bold',
    fontSize: 26,
  },
  subtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
  },
  centerWrap: {
    paddingHorizontal: 16,
    gap: 10,
  },
  listContent: {
    paddingHorizontal: 16,
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: colors.radius + 4,
    borderWidth: 1,
    padding: 14,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  rowName: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
  },
  rowRole: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    marginTop: 1,
  },
  errorWrap: {
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
    gap: 8,
  },
  errorTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 17,
    marginTop: 8,
  },
  errorText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 12,
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderRadius: colors.radius,
  },
  retryText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
});
