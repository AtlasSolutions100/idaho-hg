import React, { useEffect, useRef, useState } from 'react';
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
import { useAuth, useSignIn } from '@clerk/expo';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import colors from '@/constants/colors';
import { useColors } from '@/hooks/useColors';

const CODE_LENGTH = 6;
const RESEND_SECONDS = 30;

/**
 * Two-step sign-in: email → 6-digit code from the email. No passwords.
 */
export default function SignInScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isSignedIn } = useAuth();
  const { signIn, errors, fetchStatus } = useSignIn();

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [errorText, setErrorText] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const codeInputRef = useRef<TextInput>(null);

  const busy = fetchStatus === 'fetching';

  useEffect(() => {
    if (isSignedIn) router.replace('/');
  }, [isSignedIn, router]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const friendlyError = (message?: string | null): string => {
    const m = (message ?? '').toLowerCase();
    if (m.includes("couldn't be found") || m.includes('not found') || m.includes('identifier')) {
      return "We couldn't find that email. Check the spelling, or ask Molly to add you to the team roster.";
    }
    if (m.includes('incorrect') || m.includes('invalid')) {
      return "That code doesn't match. Double-check the 6 digits and try again.";
    }
    if (m.includes('expired')) {
      return 'That code has expired. Tap "Send a new code" and use the newest email.';
    }
    if (m.includes('too many') || m.includes('rate')) {
      return 'Too many tries. Please wait a minute, then try again.';
    }
    return message || 'Something went wrong. Please try again.';
  };

  const sendCode = async (toEmail: string) => {
    setErrorText(null);
    const { error } = await signIn.emailCode.sendCode({
      emailAddress: toEmail.trim().toLowerCase(),
    });
    if (error) {
      setErrorText(friendlyError(error.message));
      return false;
    }
    setResendIn(RESEND_SECONDS);
    return true;
  };

  const handleEmailContinue = async () => {
    const ok = await sendCode(email);
    if (ok) {
      setCode('');
      setStep('code');
      setTimeout(() => codeInputRef.current?.focus(), 250);
    }
  };

  const handleVerify = async (fullCode: string) => {
    setErrorText(null);
    const { error } = await signIn.emailCode.verifyCode({ code: fullCode });
    if (error) {
      setErrorText(friendlyError(error.message));
      setCode('');
      return;
    }
    if (signIn.status === 'complete') {
      await signIn.finalize({
        navigate: () => {
          router.replace('/');
        },
      });
    } else {
      setErrorText('Something went wrong. Please start over.');
    }
  };

  const onCodeChange = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, CODE_LENGTH);
    setCode(digits);
    setErrorText(null);
    if (digits.length === CODE_LENGTH && !busy) {
      handleVerify(digits);
    }
  };

  const startOver = () => {
    setStep('email');
    setCode('');
    setErrorText(null);
    signIn.reset?.();
  };

  const topInset = Platform.OS === 'web' ? 67 : insets.top;
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const fieldError =
    errorText ??
    (errors?.fields?.identifier?.message
      ? friendlyError(errors.fields.identifier.message)
      : null);

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: c.background, paddingTop: topInset + 48 },
      ]}
    >
      <View style={[styles.logoCircle, { backgroundColor: c.primary }]}>
        <Feather name="clock" size={30} color={c.primaryForeground} />
      </View>
      <Text style={[styles.appName, { color: c.foreground }]}>
        Idaho Healthcare Staffing
      </Text>

      {step === 'email' ? (
        <View style={styles.formWrap}>
          <Text style={[styles.title, { color: c.foreground }]}>
            Welcome
          </Text>
          <Text style={[styles.subtitle, { color: c.mutedForeground }]}>
            Enter your work email and we'll send you a 6-digit code. No
            password needed.
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: c.card,
                borderColor: fieldError ? c.destructive : c.border,
                color: c.foreground,
              },
            ]}
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              setErrorText(null);
            }}
            placeholder="you@example.com"
            placeholderTextColor={c.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="email"
            editable={!busy}
            onSubmitEditing={() => emailValid && !busy && handleEmailContinue()}
            testID="input-email"
          />
          {fieldError && (
            <Text style={[styles.errorText, { color: c.destructive }]}>
              {fieldError}
            </Text>
          )}
          <Pressable
            onPress={handleEmailContinue}
            disabled={!emailValid || busy}
            style={({ pressed }) => [
              styles.button,
              {
                backgroundColor: c.primary,
                opacity: !emailValid || busy ? 0.5 : pressed ? 0.85 : 1,
              },
            ]}
            testID="button-send-code"
          >
            {busy ? (
              <ActivityIndicator color={c.primaryForeground} />
            ) : (
              <Text style={[styles.buttonText, { color: c.primaryForeground }]}>
                Email me a code
              </Text>
            )}
          </Pressable>
          <Text style={[styles.helpText, { color: c.mutedForeground }]}>
            New here? Ask Molly to add your email to the team roster first.
          </Text>
        </View>
      ) : (
        <View style={styles.formWrap}>
          <Text style={[styles.title, { color: c.foreground }]}>
            Check your email
          </Text>
          <Text style={[styles.subtitle, { color: c.mutedForeground }]}>
            We sent a 6-digit code to{'\n'}
            <Text style={{ fontFamily: 'Inter_600SemiBold', color: c.foreground }}>
              {email.trim().toLowerCase()}
            </Text>
          </Text>

          {/* Hidden input drives the six visible digit boxes */}
          <Pressable
            onPress={() => codeInputRef.current?.focus()}
            style={styles.codeRow}
            testID="code-boxes"
          >
            {Array.from({ length: CODE_LENGTH }).map((_, i) => {
              const active = i === code.length;
              return (
                <View
                  key={i}
                  style={[
                    styles.codeBox,
                    {
                      backgroundColor: c.card,
                      borderColor: errorText
                        ? c.destructive
                        : active
                          ? c.primary
                          : c.border,
                      borderWidth: active ? 2 : 1,
                    },
                  ]}
                >
                  <Text style={[styles.codeDigit, { color: c.foreground }]}>
                    {code[i] ?? ''}
                  </Text>
                </View>
              );
            })}
          </Pressable>
          <TextInput
            ref={codeInputRef}
            value={code}
            onChangeText={onCodeChange}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={CODE_LENGTH}
            style={styles.hiddenInput}
            editable={!busy}
            testID="input-code"
          />

          {errorText && (
            <Text style={[styles.errorText, { color: c.destructive }]}>
              {errorText}
            </Text>
          )}
          {busy && <ActivityIndicator style={{ marginTop: 16 }} color={c.primary} />}

          <Pressable
            onPress={() => sendCode(email)}
            disabled={busy || resendIn > 0}
            style={styles.linkButton}
            testID="button-resend"
          >
            <Text
              style={[
                styles.linkText,
                { color: resendIn > 0 ? c.mutedForeground : c.primary },
              ]}
            >
              {resendIn > 0
                ? `Send a new code (${resendIn}s)`
                : 'Send a new code'}
            </Text>
          </Pressable>
          <Pressable onPress={startOver} style={styles.linkButton} testID="button-start-over">
            <Text style={[styles.linkText, { color: c.mutedForeground }]}>
              Use a different email
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  logoCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appName: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    marginTop: 12,
  },
  formWrap: {
    width: '100%',
    maxWidth: 400,
    marginTop: 40,
  },
  title: {
    fontFamily: 'Inter_700Bold',
    fontSize: 26,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 24,
  },
  input: {
    height: 52,
    borderRadius: colors.radius,
    borderWidth: 1,
    paddingHorizontal: 16,
    fontFamily: 'Inter_500Medium',
    fontSize: 16,
  },
  button: {
    height: 52,
    borderRadius: colors.radius,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  buttonText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
  },
  helpText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 20,
  },
  codeRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  codeBox: {
    width: 48,
    height: 58,
    borderRadius: colors.radius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeDigit: {
    fontFamily: 'Inter_700Bold',
    fontSize: 24,
  },
  hiddenInput: {
    position: 'absolute',
    opacity: 0.011,
    height: 1,
    width: 1,
  },
  errorText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 10,
    textAlign: 'center',
  },
  linkButton: {
    alignSelf: 'center',
    marginTop: 20,
    padding: 4,
  },
  linkText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
});
