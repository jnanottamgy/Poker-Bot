import { useParams } from 'react-router';
import { CreateSetup } from './CreateSetup';
import { EditSetup } from './EditSetup';
import './setup.css';

/**
 * §2.2 Tournament setup wizard. /tournaments/new creates a tournament;
 * /t/:tournamentId/setup edits it while DRAFT / REGISTRATION and shows a
 * read-only summary afterwards. The mode comes from the route itself: on
 * /tournaments/new the shell's tournament scope still names the last
 * tournament opened (for the top bar), which must not turn "create" into "edit".
 */
export default function SetupSection() {
  const { tournamentId } = useParams();
  return tournamentId ? <EditSetup key={tournamentId} tournamentId={tournamentId} /> : <CreateSetup />;
}
