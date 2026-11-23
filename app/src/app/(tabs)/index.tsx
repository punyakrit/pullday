import { useSession } from '../../lib/session';
import { Today } from '../../today/Today';

export default function TodayTab() {
  const session = useSession();
  return session.status === 'in' ? <Today key={session.user.id} engine={session.engine} /> : null;
}
