import { Redirect } from 'expo-router';

/** The tab's button opens the add modal directly; this only catches a deep link to the route. */
export default function AddRoute() {
  return <Redirect href="/transaction/new" />;
}
