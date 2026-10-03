import { describe, it, expect } from 'vitest';
import { ApiError } from '@workspace/api-client-react';
import { failureReason } from './load-failure';

const apiError = (status: number, data: unknown = null) =>
  new ApiError(new Response(null, { status }), data, {
    method: 'GET',
    url: '/api/anything',
  });

// What a panel tells Molly when it has no data. The whole point of this
// mapping is that "it isn't working" becomes something she can act on, so
// each branch is pinned to the thing she would have to do about it.
describe('failureReason', () => {
  it('names the access reasons the server sends a code for', () => {
    expect(failureReason(apiError(403, { code: 'SIGN_IN_DISABLED' }))).toContain(
      'turned off',
    );
    expect(failureReason(apiError(403, { code: 'LINK_REQUEST_PENDING' }))).toContain(
      'confirm',
    );
    expect(failureReason(apiError(403, { code: 'NOT_LINKED' }))).toContain('linked');
  });

  it('tells an expired session apart from a forbidden one', () => {
    expect(failureReason(apiError(401))).toContain('expired');
    expect(failureReason(apiError(403))).toContain('administrator');
  });

  it('explains a missing record and a server fault differently', () => {
    expect(failureReason(apiError(404))).toContain('removed');
    expect(failureReason(apiError(500))).toContain('our side');
  });

  it('prefers the server’s own wording when it sent some', () => {
    expect(failureReason(apiError(400, { message: 'Pick a date range first.' }))).toBe(
      'Pick a date range first.',
    );
  });

  it('covers the commonest failure of all — no response at all', () => {
    // A dropped connection is not an ApiError, and "failed to load" is the
    // least useful thing to say about it.
    expect(failureReason(new TypeError('Failed to fetch'))).toContain('connection');
    expect(failureReason(undefined)).toContain('connection');
  });
});
