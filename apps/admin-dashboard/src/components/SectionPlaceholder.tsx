import { EmptyState } from '@jpb/ui';
import { sectionById } from '../app/sections';
import type { SectionId } from '../app/sections';
import { PageHeader } from './PageHeader';

/** Temporary body of a section that is not built yet (see CONTRIBUTING-SECTIONS.md). */
export function SectionPlaceholder({ section }: { section: SectionId }) {
  const def = sectionById(section);
  return (
    <div className="acr-page">
      <PageHeader title={def.label} icon={def.icon} />
      <EmptyState
        icon={def.icon}
        title={`${def.label} is coming soon`}
        description={`This screen is specified in docs/ADMIN_CONTROL_ROOM.md ${def.spec} and is being built. Everything it needs — API client, mock data, live updates and permission gates — is already wired.`}
      />
    </div>
  );
}
