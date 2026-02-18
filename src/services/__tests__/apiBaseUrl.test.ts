import { describe, expect, it } from 'vitest';
import { normalizeApiBaseUrl, resolveApiBaseUrl } from '../api';

describe('API base URL resolution', () => {
  it('defaults to same-origin in production when VITE_API_URL is unset', () => {
    expect(resolveApiBaseUrl({ isProd: true })).toBe('');
  });

  it('defaults to localhost backend in development when VITE_API_URL is unset', () => {
    expect(resolveApiBaseUrl({ isProd: false })).toBe('http://localhost:3001');
  });

  it('uses explicit VITE_API_URL override and normalizes trailing slashes', () => {
    expect(resolveApiBaseUrl({ isProd: true, viteApiUrl: ' https://api.example.com/ ' })).toBe(
      'https://api.example.com',
    );
  });

  it('keeps explicit empty override as same-origin', () => {
    expect(resolveApiBaseUrl({ isProd: false, viteApiUrl: '' })).toBe('');
  });

  it('normalizes root URL slash', () => {
    expect(normalizeApiBaseUrl('/')).toBe('');
  });
});
