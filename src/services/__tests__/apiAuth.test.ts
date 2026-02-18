import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  authApi,
  resetSessionExpiredSignalForTests,
  SESSION_EXPIRED_EVENT,
  SessionExpiredError,
} from '../api';

describe('API auth error handling', () => {
  beforeEach(() => {
    resetSessionExpiredSignalForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps 401 responses to SessionExpiredError and emits a session-expired signal', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const onExpired = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);

    await expect(authApi.getCurrentUser()).rejects.toBeInstanceOf(SessionExpiredError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onExpired).toHaveBeenCalledTimes(1);

    window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  });
});
