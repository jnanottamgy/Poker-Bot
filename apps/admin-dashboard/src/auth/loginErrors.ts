import { ApiError } from '@jpb/client-sdk';

export interface LoginErrorCopy {
  kind: 'credentials' | 'locked' | 'rate-limited' | 'network' | 'server' | 'invalid';
  title: string;
  description: string;
}

/** Friendly sign-in failure copy. Deliberately does not reveal whether a username exists. */
export function loginErrorCopy(err: unknown): LoginErrorCopy {
  if (err instanceof ApiError) {
    if (err.status === 0 || err.code === 'NETWORK') {
      return { kind: 'network', title: 'Cannot reach the server', description: 'Check the venue network or VPN, then try again.' };
    }
    if (err.status === 423 || err.code === 'ACCOUNT_LOCKED') {
      return {
        kind: 'locked',
        title: 'Account temporarily locked',
        description: `${err.message || 'Too many failed attempts.'} For urgent access ask a super admin to unlock your account.`,
      };
    }
    if (err.status === 429) {
      return { kind: 'rate-limited', title: 'Too many sign-in attempts', description: 'For security, sign-in is paused for this device. Wait about 30 seconds and try again.' };
    }
    if (err.status === 400) {
      return { kind: 'invalid', title: 'Missing details', description: err.message || 'Enter a username and password.' };
    }
    if (err.status === 401) {
      return { kind: 'credentials', title: 'Username or password is incorrect', description: 'Check the spelling and that Caps Lock is off. After 5 failed attempts the account locks for 15 minutes.' };
    }
  }
  return { kind: 'server', title: 'Sign-in is unavailable right now', description: 'The server had a problem. Nothing is wrong with your account — try again in a moment.' };
}
