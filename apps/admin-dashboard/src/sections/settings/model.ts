import type { FeatureFlags, SpectatorConfig, TournamentConfig, TournamentStatus } from '@jpb/shared-types';
import { validateTournamentConfig } from '@jpb/validation';
import type { RunningConfigChanges } from '../../api/types';
import { FEATURE_INFO, SPECTATOR_INFO } from '../setup/model/features';
import { friendlyMessage } from '../setup/model/issues';

/**
 * §2.21 Settings — per-tournament feature flags, spectator / display options
 * and the players' default sound / haptics. Pure helpers (tested).
 */

export interface SettingsDraft {
  features: FeatureFlags;
  spectators: SpectatorConfig;
}

/**
 * How a save reaches the server:
 *  - 'config'  : before registration closes, PUT /config with the whole configuration (level 1);
 *  - 'running' : afterwards, PATCH /config/running { changes: { features, spectators } } (level 2, word EDIT);
 *  - 'ended'   : completed / cancelled — read-only.
 */
export type SaveMode = 'config' | 'running' | 'ended';

const CONFIG_STATUSES: readonly TournamentStatus[] = ['DRAFT', 'REGISTRATION'];
const ENDED_STATUSES: readonly TournamentStatus[] = ['COMPLETED', 'CANCELLED'];

export function saveMode(status: TournamentStatus): SaveMode {
  if (CONFIG_STATUSES.includes(status)) return 'config';
  if (ENDED_STATUSES.includes(status)) return 'ended';
  return 'running';
}

export function draftOf(config: TournamentConfig): SettingsDraft {
  return { features: { ...config.features }, spectators: { ...config.spectators } };
}

export interface SettingChange {
  key: string;
  label: string;
  before: string;
  after: string;
}

const onOff = (v: boolean) => (v ? 'On' : 'Off');
const delayText = (s: number) => (Number.isFinite(s) ? (s === 0 ? 'Live (0 s)' : `${s} s`) : '—');

/** Every setting that differs, in screen order, with before / after text. */
export function settingChanges(base: SettingsDraft, draft: SettingsDraft): SettingChange[] {
  const out: SettingChange[] = [];
  for (const f of FEATURE_INFO) {
    if (base.features[f.key] !== draft.features[f.key]) out.push({ key: `features.${f.key}`, label: f.label, before: onOff(base.features[f.key]), after: onOff(draft.features[f.key]) });
  }
  for (const s of SPECTATOR_INFO) {
    if (base.spectators[s.key] !== draft.spectators[s.key]) out.push({ key: `spectators.${s.key}`, label: s.label, before: onOff(base.spectators[s.key]), after: onOff(draft.spectators[s.key]) });
  }
  if (!Object.is(base.spectators.delaySeconds, draft.spectators.delaySeconds)) {
    out.push({ key: 'spectators.delaySeconds', label: 'Spectator delay', before: delayText(base.spectators.delaySeconds), after: delayText(draft.spectators.delaySeconds) });
  }
  return out;
}

/** Only the changed keys, grouped as PATCH /config/running expects (the server merges them). */
export function runningChanges(base: SettingsDraft, draft: SettingsDraft): RunningConfigChanges {
  const features: Partial<FeatureFlags> = {};
  const spectators: Partial<SpectatorConfig> = {};
  for (const k of Object.keys(draft.features) as Array<keyof FeatureFlags>) if (base.features[k] !== draft.features[k]) features[k] = draft.features[k];
  for (const k of Object.keys(draft.spectators) as Array<keyof SpectatorConfig>) {
    if (!Object.is(base.spectators[k], draft.spectators[k])) (spectators as Record<string, unknown>)[k] = draft.spectators[k];
  }
  return { ...(Object.keys(features).length ? { features } : {}), ...(Object.keys(spectators).length ? { spectators } : {}) };
}

/** The full configuration with the draft applied (PUT /config before registration closes). */
export function withSettings(config: TournamentConfig, draft: SettingsDraft): TournamentConfig {
  return { ...config, features: { ...draft.features }, spectators: { ...draft.spectators } };
}

/** Field problems from @jpb/validation (the server's own rules), keyed by path ("spectators.delaySeconds"). */
export function settingIssues(config: TournamentConfig, draft: SettingsDraft): Map<string, string> {
  const out = new Map<string, string>();
  const r = validateTournamentConfig(withSettings(config, draft));
  if (r.ok) return out;
  for (const issue of r.error.issues) {
    const head = issue.segments[0];
    if ((head === 'features' || head === 'spectators') && !out.has(issue.path)) out.set(issue.path, friendlyMessage(issue));
  }
  return out;
}
