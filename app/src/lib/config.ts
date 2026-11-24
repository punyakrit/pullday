/**
 * Where the backend is: the hosted one, or your own with EXPO_PUBLIC_API_URL in app/.env. It is read when
 * the app is built. The same default is in app.config.ts.
 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://922a46307bd4607b7d32.agent37.app';

/** Accounts that may open the dev menu. The server checks this too. */
export const TEST_ACCOUNTS = ['new', 'today', 'done', 'freeze', 'broken', 'collector'].map((name) => `${name}@pullday.test`);
