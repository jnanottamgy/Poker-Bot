import type { TournamentStatus } from '@jpb/shared-types';

export type StatusGroup = 'all' | 'live' | 'registration' | 'draft' | 'finished';

export const STATUS_GROUPS: Record<Exclude<StatusGroup, 'all'>, readonly TournamentStatus[]> = {
  live: ['STARTING', 'RUNNING', 'BREAK', 'PAUSED', 'FINAL_TABLE'],
  registration: ['REGISTRATION', 'REGISTRATION_CLOSED'],
  draft: ['DRAFT'],
  finished: ['COMPLETED', 'CANCELLED'],
};

export function inGroup(status: TournamentStatus, group: StatusGroup): boolean {
  return group === 'all' || STATUS_GROUPS[group].includes(status);
}

export const GROUP_LABELS: Record<StatusGroup, string> = {
  all: 'All',
  live: 'Live',
  registration: 'Registration',
  draft: 'Drafts',
  finished: 'Finished',
};
