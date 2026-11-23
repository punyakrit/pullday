/** Where the backend is. Set EXPO_PUBLIC_API_URL in app/.env. It is read when the app is built. */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

/** Accounts that may open the dev menu. The server checks this too. */
export const TEST_ACCOUNTS = ['new', 'today', 'done', 'freeze', 'broken', 'collector'].map((name) => `${name}@pullday.test`);
