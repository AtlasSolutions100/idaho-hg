import React, { useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetMyEmployeeQueryKey,
  getListEmployeesQueryKey,
  useGetMyEmployee,
  useUpdateMyContact,
} from '@workspace/api-client-react';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Redirect, useRouter } from 'expo-router';
import colors from '@/constants/colors';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useColors } from '@/hooks/useColors';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * "My Info" — a signed-in employee views and edits their own phone, contact
 * email, and home address. The server pins the update to their own roster
 * row, so there's no way to touch anyone else's record.
 */
export default function ProfileScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: employee } = useGetMyEmployee();

  // Seed the form once from the loaded profile.
  const [phone, setPhone] = useState(employee?.phone ?? '');
  const [contactEmail, setContactEmail] = useState(employee?.contactEmail ?? '');
  const [address, setAddress] = useState(employee?.address ?? '');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const updateContact = useUpdateMyContact({
    mutation: {
      onSuccess: () => {
        // Refresh both my own profile and Molly's admin list (if cached).
        queryClient.invalidateQueries({ queryKey: getGetMyEmployeeQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListEmployeesQueryKey() });
        if (Platform.OS !== 'web') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        setSaved(true);
        setTimeout(() => router.back(), 900);
      },
      onError: (error) => {
        setErrorMessage(
          error?.message ??
            "We couldn't save your info. Please check your connection and try again.",
        );
      },
    },
  });

  if (!employee) return <Redirect href="/" />;

  const emailValid = !contactEmail.trim() || EMAIL_PATTERN.test(contactEmail.trim());
  const canSave = emailValid && !updateContact.isPending && !saved;

  const handleSave = () => {
    if (!canSave) return;
    setErrorMessage(null);
    // Send every field: blank clears it on the server, which is exactly what
    // an employee emptying a box expects.
    updateContact.mutate({
      data: {
        phone: phone.trim(),
        contactEmail: contactEmail.trim(),
        address: address.trim(),
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
        <Text style={[styles.headerTitle, { color: c.foreground }]}>My Info</Text>
        <View style={styles.closeButton} />
      </View>

      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[styles.content, { paddingBottom: bottomInset + 32 }]}
        keyboardShouldPersistTaps="handled"
        bottomOffset={24}
      >
        <View style={[styles.identityCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.identityName, { color: c.foreground }]}>{employee.name}</Text>
          <Text style={[styles.identityRole, { color: c.mutedForeground }]}>
            {employee.role}
            {employee.email ? ` · Signs in as ${employee.email}` : ''}
          </Text>
        </View>

        <Text style={[styles.helpText, { color: c.mutedForeground }]}>
          Keep your contact info current so Molly can reach you. Leave a box
          empty to clear it.
        </Text>

        <SectionLabel text="Phone" />
        <TextInput
          value={phone}
          onChangeText={setPhone}
          placeholder="(208) 555-0123"
          placeholderTextColor={c.mutedForeground}
          keyboardType="phone-pad"
          style={[
            styles.input,
            { backgroundColor: c.card, borderColor: c.input, color: c.foreground },
          ]}
          testID="input-phone"
        />

        <SectionLabel text="Contact email" />
        <TextInput
          value={contactEmail}
          onChangeText={setContactEmail}
          placeholder="you@example.com"
          placeholderTextColor={c.mutedForeground}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          style={[
            styles.input,
            {
              backgroundColor: c.card,
              borderColor: contactEmail && !emailValid ? c.destructive : c.input,
              color: c.foreground,
            },
          ]}
          testID="input-contact-email"
        />
        {contactEmail && !emailValid ? (
          <Text style={[styles.fieldError, { color: c.destructive }]}>
            That doesn't look like a valid email address.
          </Text>
        ) : null}

        <SectionLabel text="Home address" />
        <TextInput
          value={address}
          onChangeText={setAddress}
          placeholder={'123 Main St\nBoise, ID 83702'}
          placeholderTextColor={c.mutedForeground}
          multiline
          numberOfLines={3}
          style={[
            styles.input,
            styles.addressInput,
            { backgroundColor: c.card, borderColor: c.input, color: c.foreground },
          ]}
          testID="input-address"
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
          onPress={handleSave}
          disabled={!canSave}
          style={({ pressed }) => [
            styles.saveButton,
            {
              backgroundColor: saved ? c.accent : c.primary,
              opacity: !canSave && !saved ? 0.5 : pressed ? 0.85 : 1,
            },
          ]}
          testID="button-save-contact"
        >
          {updateContact.isPending ? (
            <ActivityIndicator color={c.primaryForeground} />
          ) : saved ? (
            <>
              <Feather name="check" size={18} color={c.accentForeground} />
              <Text style={[styles.saveText, { color: c.accentForeground }]}>Saved!</Text>
            </>
          ) : (
            <>
              <Feather name="check" size={18} color={c.primaryForeground} />
              <Text style={[styles.saveText, { color: c.primaryForeground }]}>
                Save My Info
              </Text>
            </>
          )}
        </Pressable>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

function SectionLabel({ text }: { text: string }) {
  const c = useColors();
  return <Text style={[styles.sectionLabel, { color: c.foreground }]}>{text}</Text>;
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
  identityCard: {
    borderWidth: 1,
    borderRadius: colors.radius + 4,
    padding: 16,
  },
  identityName: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 17,
  },
  identityRole: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    marginTop: 2,
  },
  helpText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 14,
  },
  sectionLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    marginTop: 20,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderRadius: colors.radius,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
  },
  addressInput: {
    minHeight: 84,
    textAlignVertical: 'top',
  },
  fieldError: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    marginTop: 6,
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
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: colors.radius + 2,
    paddingVertical: 15,
    marginTop: 24,
  },
  saveText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
  },
});
