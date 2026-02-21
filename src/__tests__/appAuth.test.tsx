import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  exchangeToken: vi.fn(),
  logout: vi.fn(),
  getSyncStatus: vi.fn(),
}));

vi.mock('../services/api', () => ({
  authApi: {
    getCurrentUser: mocks.getCurrentUser,
    exchangeToken: mocks.exchangeToken,
    logout: mocks.logout,
  },
  ardaApi: {
    getSyncStatus: mocks.getSyncStatus,
  },
  buildArdaOpenUrl: (tenantId?: string | null) =>
    tenantId ? `https://live.app.arda.cards/?tenantId=${tenantId}` : 'https://live.app.arda.cards',
  getLastSuccessfulSyncTenant: (syncStatus: { recent?: Array<{ success: boolean; tenantId?: string; email?: string; timestamp: string }> }) => {
    for (const event of syncStatus?.recent ?? []) {
      if (event.success && event.tenantId) {
        return {
          tenantId: event.tenantId,
          email: event.email,
          timestamp: event.timestamp,
        };
      }
    }
    return null;
  },
  SESSION_EXPIRED_EVENT: 'orderpulse:session-expired',
}));

vi.mock('../views/LoginScreen', () => ({
  LoginScreen: ({ onCheckingAuth }: { onCheckingAuth?: boolean }) => (
    <div>{onCheckingAuth ? 'checking-auth' : 'login-screen'}</div>
  ),
}));

vi.mock('../views/OnboardingFlow', () => ({
  OnboardingFlow: () => <div>onboarding-flow</div>,
}));

vi.mock('../views/MobileScanner', () => ({
  MobileScanner: () => <div>mobile-scanner</div>,
}));

vi.mock('../components/Icons', () => ({
  Icons: new Proxy(
    {},
    {
      get: () => () => null,
    },
  ),
}));

import App from '../App';

describe('App auth session handling', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.getCurrentUser.mockReset();
    mocks.exchangeToken.mockReset();
    mocks.logout.mockReset();
    mocks.getSyncStatus.mockReset();
  });

  it('returns to login when the session-expired signal is dispatched', async () => {
    mocks.getCurrentUser.mockResolvedValue({
      user: {
        id: 'user-1',
        email: 'user@example.com',
        name: 'User',
        picture_url: '',
      },
    });

    render(<App />);

    await screen.findByText('onboarding-flow');
    act(() => {
      window.dispatchEvent(new CustomEvent('orderpulse:session-expired'));
    });
    await screen.findByText('login-screen');
    expect(screen.queryByText('onboarding-flow')).not.toBeInTheDocument();
  });

  it('opens Arda with the last successful sync tenant in completion view', async () => {
    localStorage.setItem('orderPulse_onboardingComplete', 'true');
    mocks.getCurrentUser.mockResolvedValue({
      user: {
        id: 'user-1',
        email: 'user@example.com',
        name: 'User',
        picture_url: '',
      },
    });
    mocks.getSyncStatus.mockResolvedValue({
      recent: [
        {
          id: 'event-1',
          operation: 'item_create',
          success: true,
          requested: 1,
          successful: 1,
          failed: 0,
          timestamp: '2026-02-20T10:02:51.324Z',
          tenantId: 'tenant-abc',
          email: 'user@example.com',
        },
      ],
    });

    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<App />);

    await screen.findByText('Setup Complete!');
    await screen.findByText('tenant-abc');
    await screen.findByText('If Arda asks you to sign in, use this same account email.');
    fireEvent.click(screen.getByRole('button', { name: 'Open Arda' }));

    expect(openSpy).toHaveBeenCalledWith(
      'https://live.app.arda.cards/?tenantId=tenant-abc',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('falls back to Arda home when no successful tenant is available', async () => {
    localStorage.setItem('orderPulse_onboardingComplete', 'true');
    mocks.getCurrentUser.mockResolvedValue({
      user: {
        id: 'user-1',
        email: 'user@example.com',
        name: 'User',
        picture_url: '',
      },
    });
    mocks.getSyncStatus.mockResolvedValue({
      recent: [
        {
          id: 'event-1',
          operation: 'item_create',
          success: false,
          requested: 1,
          successful: 0,
          failed: 1,
          timestamp: '2026-02-20T10:02:51.324Z',
        },
      ],
    });

    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<App />);

    await screen.findByText('Opening Arda home (no synced tenant detected).');
    fireEvent.click(screen.getByRole('button', { name: 'Open Arda' }));

    expect(openSpy).toHaveBeenCalledWith(
      'https://live.app.arda.cards',
      '_blank',
      'noopener,noreferrer',
    );
  });
});
