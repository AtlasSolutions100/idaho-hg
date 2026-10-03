import {
  useGetSession,
  getGetSessionQueryKey,
  type Session,
} from '@workspace/api-client-react';

export type { Session };

/**
 * Who this browser is signed in as, and what it may use.
 *
 * One shared query so every screen agrees and the server is asked once. It
 * deliberately does not retry: a 401 here is an answer ("not signed in"),
 * not a failure worth hammering the server over, and retrying would leave
 * the gates spinning instead of explaining themselves.
 */
export function useSession() {
  return useGetSession({
    query: {
      queryKey: getGetSessionQueryKey(),
      retry: false,
      // The answer only changes on sign-in/out, which clears the cache.
      staleTime: 5 * 60 * 1000,
    },
  });
}
