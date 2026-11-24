import { Redirect } from 'expo-router';

/** Links from outside are sent to Today before they get here. This is for what is left. */
export default function NotFound() {
  return <Redirect href="/" />;
}
