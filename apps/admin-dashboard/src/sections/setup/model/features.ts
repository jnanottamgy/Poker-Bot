import type { FeatureFlags, SpectatorConfig } from '@jpb/shared-types';
import type { IconName } from '@jpb/ui';

/**
 * Plain-words descriptions of the per-tournament feature flags and spectator
 * options, shared by the setup wizard (step 8) and the Settings screen.
 */

export type FeatureKey = keyof FeatureFlags;

export interface FeatureInfo {
  key: FeatureKey;
  label: string;
  description: string;
  icon: IconName;
  /** 'player' = a default for every player's device (they can still change it). */
  scope: 'tournament' | 'player';
}

export const FEATURE_INFO: readonly FeatureInfo[] = [
  { key: 'spectatorMode', label: 'Spectator mode', icon: 'eye', scope: 'tournament', description: 'Spectator links work for this tournament (public cards and actions only, with the spectator delay).' },
  { key: 'broadcastDisplay', label: 'Big-screen display', icon: 'monitor', scope: 'tournament', description: 'Venue screens may follow this tournament (clock, leaderboard, announcements).' },
  { key: 'lateRegistration', label: 'Late registration', icon: 'user', scope: 'tournament', description: 'Master switch for late registration; the window itself is set in the Registration step.' },
  { key: 'advancedFairnessAudit', label: 'Advanced fairness audit', icon: 'shield', scope: 'tournament', description: 'After the seed is revealed, fairness records include every seat’s hole cards and the burn cards.' },
  { key: 'soundEffects', label: 'Sound effects', icon: 'volume', scope: 'player', description: 'Default for players: chips, cards and “your turn” sounds.' },
  { key: 'haptics', label: 'Haptics', icon: 'phone', scope: 'player', description: 'Default for players: vibration on “your turn” and timer warnings (phones that support it).' },
];

export type SpectatorToggleKey = Exclude<keyof SpectatorConfig, 'delaySeconds'>;

export const SPECTATOR_INFO: ReadonlyArray<{ key: SpectatorToggleKey; label: string; description: string }> = [
  { key: 'enabled', label: 'Allow spectators', description: 'Anyone given a spectator link may watch tables (never hole cards).' },
  { key: 'publicWatch', label: 'Public watch', description: 'Anyone with the tournament link can watch, without signing in.' },
  { key: 'allowEliminatedPlayers', label: 'Eliminated players may watch', description: 'Busted players keep a spectator view instead of being sent to the summary.' },
];
