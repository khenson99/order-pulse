import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  exchangeToken: vi.fn(),
  logout: vi.fn(),
}));

vi.mock('../services/api', () => ({
  authApi: {
    getCurrentUser: mocks.getCurrentUser,
    exchangeToken: mocks.exchangeToken,
    logout: mocks.logout,
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
});
