import { createContext, useContext } from 'react';
import type { TournamentConfig, TournamentStatus } from '@jpb/shared-types';
import type { DraftMeta, WizardDraft } from '../model/draft';
import type { ValidationView, WizardIssue } from '../model/issues';
import type { StepId } from '../model/steps';

export type WizardMode = 'create' | 'edit';

export interface WizardEnv {
  mode: WizardMode;
  tournamentId: string | null;
  status: TournamentStatus | null;
  /** The join code players actually use (the tournament record's), when it exists. */
  liveJoinCode: string | null;
  /** Fairness commitment, known once the tournament exists. */
  serverSeedHash: string | null;
}

export interface UpdateOptions {
  /** Bulk change (preset, generator, scaling, distribution): offer an Undo with this label. */
  undoLabel?: string;
}

export interface WizardContextValue {
  draft: WizardDraft;
  config: TournamentConfig;
  meta: DraftMeta;
  readOnly: boolean;
  env: WizardEnv;
  validation: ValidationView;
  update: (fn: (c: TournamentConfig) => TournamentConfig, opts?: UpdateOptions) => void;
  setMeta: (patch: Partial<DraftMeta>) => void;
  issuesAt: (path: string) => WizardIssue[];
  goToIssue: (issue: Pick<WizardIssue, 'path' | 'segments' | 'step'>) => void;
  goToStep: (step: StepId) => void;
  /** Virtualized lists register how to bring row `index` of `arrayPath` into view. */
  registerScroller: (arrayPath: string, scroll: (index: number) => void) => () => void;
}

export const WizardContext = createContext<WizardContextValue | null>(null);

export function useWizard(): WizardContextValue {
  const ctx = useContext(WizardContext);
  if (!ctx) throw new Error('useWizard() outside the setup wizard');
  return ctx;
}
