import type { ReactNode } from 'react';
import type { TournamentConfig } from '@jpb/shared-types';
import { Badge, Button, Icon, formatChips, formatCount, formatMoneyMinor, formatOrdinal } from '@jpb/ui';
import { REGISTRATION_FIELD_LABELS, effectiveRegistrationFields } from '@jpb/validation';
import { formatDateTime } from '../../../lib/time';
import { projection as projectLevels, startingDepth } from '../model/blinds';
import { FEATURE_INFO } from '../model/features';
import { bbText, durationLabel, isNum } from '../model/format';
import { totalMinor } from '../model/prizes';
import { stepDef } from '../model/steps';
import type { StepId } from '../model/steps';
import { matchingPreset, seatingPreview, seatingText } from '../model/tables';

type Row = [label: string, value: ReactNode];

const ANTE_TEXT: Readonly<Record<TournamentConfig['anteType'], string>> = { NONE: 'No ante', BB_ANTE: 'Big-blind ante', ALL_PLAYERS: 'Every player antes' };
const onOff = (v: boolean) => (v ? 'On' : 'Off');
const TOP_PLACES = 3;

function breakText(b: TournamentConfig['breaks'][number]): string {
  const when = b.everyLevels !== undefined ? `Every ${b.everyLevels} levels` : `After level ${b.afterLevel ?? '—'}`;
  return `${when} · ${isNum(b.durationSeconds) ? durationLabel(b.durationSeconds) : '—'}`;
}

/** Rows of the summary card for one step (plain words, no editing). */
export function summaryRows(step: StepId, c: TournamentConfig): Row[] {
  switch (step) {
    case 'basics':
      return [
        ['Name', c.name || '—'],
        ['Join code', <span className="jpb-mono">{c.joinCode || '—'}</span>],
        ['Scheduled start', c.startTime !== null && isNum(c.startTime) ? formatDateTime(c.startTime) : 'Not scheduled (start by hand)'],
        ['Auto-start', onOff(c.autoStart)],
      ];
    case 'players': {
      const preset = matchingPreset(c.tables);
      const preview = isNum(c.maxPlayers) ? seatingPreview(c.maxPlayers, c.tables, c.balancing.consolidateBy) : null;
      return [
        ['Players', isNum(c.minPlayers) && isNum(c.maxPlayers) ? `${formatCount(c.minPlayers)} – ${formatCount(c.maxPlayers)}` : '—'],
        ['Tables', `${preset ? `${preset.label} · ` : ''}${c.tables.maxSize} seats, plays ${c.tables.targetSize}-handed, break below ${c.tables.minSize}`],
        ['Final table', `${c.tables.finalTableSize} players`],
        ['Consolidation', c.balancing.consolidateBy === 'MAX' ? 'Maximum size (MAX)' : 'Target size (TARGET)'],
        ['Full field', preview ? seatingText(preview) : '—'],
      ];
    }
    case 'blinds': {
      const first = c.blindSchedule[0];
      const proj = projectLevels(c.blindSchedule, c.breaks);
      const depth = startingDepth(c.startingStack, c.blindSchedule);
      return [
        ['Starting stack', isNum(c.startingStack) ? `${formatChips(c.startingStack)} chips` : '—'],
        ['Antes', ANTE_TEXT[c.anteType]],
        ['Levels', `${formatCount(c.blindSchedule.length)}${first ? ` · from ${formatChips(first.smallBlind)} / ${formatChips(first.bigBlind)}` : ''}`],
        ['Starting depth', depth !== null && first ? bbText(c.startingStack, first.bigBlind) : '—'],
        ['Projected duration', proj ? durationLabel(proj.totalSeconds) : '—'],
        ['Speed mode', c.speedMode ? 'ON (developer / simulation only)' : 'Off'],
      ];
    }
    case 'breaks':
      return c.breaks.length === 0 ? [['Breaks', 'None']] : c.breaks.map((b, i): Row => [`Break ${i + 1}`, `${breakText(b)}${b.message ? ` · “${b.message}”` : ''}`]);
    case 'timing': {
      const t = c.timing;
      return [
        ['Action timer', `${t.actionTimerSeconds} s (+ ${t.actionGraceMs / 1000} s grace)`],
        ['Away', `after ${t.awayAfterTimeouts} timeout${t.awayAfterTimeouts === 1 ? '' : 's'} · ${t.awayActionTimerSeconds} s timer`],
        ['Between hands', `${t.betweenHandsDelayMs / 1000} s (+ ${t.showdownDelayMs / 1000} s after a showdown)`],
        ['Start countdown', `${t.startCountdownSeconds} s`],
        ['Hand-for-hand at the bubble', onOff(c.handForHand.autoAtBubble)],
      ];
    }
    case 'registration': {
      const fields = effectiveRegistrationFields(c.registration.fields)
        .map((f) => `${f.label ?? REGISTRATION_FIELD_LABELS[f.key]}${f.required ? ' *' : ''}`)
        .join(', ');
      return [
        ['Form fields', fields],
        ['Approval', c.registration.requireApproval ? 'Staff approve each entry' : 'Automatic'],
        ['Access code', c.registration.accessCode ? <span className="jpb-mono">{c.registration.accessCode}</span> : 'None'],
        ['Deadline', c.registrationDeadline !== null && isNum(c.registrationDeadline) ? formatDateTime(c.registrationDeadline) : 'None (close by hand)'],
        ['Late registration', c.lateRegistration.enabled ? `Until the end of level ${c.lateRegistration.untilLevel}` : 'Off'],
        ['Re-entry', c.reentry.enabled ? `Up to ${c.reentry.maxEntriesPerPlayer} entries, until level ${c.reentry.untilLevel}` : 'Off'],
      ];
    }
    case 'prizes': {
      const p = c.prizeStructure;
      const total = totalMinor(p.places);
      const cur = p.currency || 'INR';
      const top = p.places
        .slice(0, TOP_PLACES)
        .map((x) => `${formatOrdinal(x.position)} ${isNum(x.amountMinor) ? formatMoneyMinor(x.amountMinor, cur) : '—'}`)
        .join(' · ');
      return [
        ['Currency', p.currency],
        ['Paid places', formatCount(p.places.length)],
        ['Prize pool', total === null ? '—' : formatMoneyMinor(total, cur)],
        ['Top', top || '—'],
        ...(p.notes ? [['Notes', p.notes] as Row] : []),
      ];
    }
    case 'display': {
      const s = c.spectators;
      const on = FEATURE_INFO.filter((f) => c.features[f.key]).map((f) => f.label);
      return [
        ['Spectators', s.enabled ? `On${s.publicWatch ? ' · public' : ''}${s.allowEliminatedPlayers ? ' · eliminated players may watch' : ''}` : 'Off'],
        ['Spectator delay', isNum(s.delaySeconds) && s.delaySeconds > 0 ? durationLabel(s.delaySeconds) : 'Live (no delay)'],
        ['Features on', on.length ? on.join(', ') : 'None'],
      ];
    }
    case 'balancing': {
      const b = c.balancing;
      const w = b.weights;
      return [
        ['Maximum imbalance', `${b.maxImbalance} player${b.maxImbalance === 1 ? '' : 's'}`],
        ['Recent-move window', `${b.recentMoveWindowHands} hands`],
        ['Weights', <span className="jpb-mono">{`blind ${w.blindFairness} · position ${w.position} · recent ${w.recentMove} · seat ${w.seatCompatibility}`}</span>],
      ];
    }
    case 'review':
      return [];
  }
}

const SUMMARY_STEPS: readonly StepId[] = ['basics', 'players', 'blinds', 'breaks', 'timing', 'registration', 'prizes', 'display', 'balancing'];

export interface ConfigSummaryProps {
  config: TournamentConfig;
  countByStep?: Readonly<Record<StepId, number>>;
  /** Edit buttons (omitted in the read-only summary). */
  onEdit?: (step: StepId) => void;
}

/** The whole configuration at a glance, one card per wizard step. */
export function ConfigSummary({ config, countByStep, onEdit }: ConfigSummaryProps) {
  return (
    <div className="acr-setup-summary">
      {SUMMARY_STEPS.map((step) => {
        const def = stepDef(step);
        const problems = countByStep?.[step] ?? 0;
        return (
          <section key={step} className="acr-setup-summary__card" aria-label={`${def.title} summary`}>
            <header className="acr-setup-summary__head">
              <h4 className="acr-setup-summary__title">
                <Icon name={def.icon} /> {def.title}
              </h4>
              {problems > 0 && (
                <Badge tone="danger">
                  {problems} problem{problems === 1 ? '' : 's'}
                </Badge>
              )}
              {onEdit && (
                <Button size="sm" variant="ghost" onClick={() => onEdit(step)} aria-label={`Edit ${def.title}`}>
                  Edit
                </Button>
              )}
            </header>
            <dl className="acr-setup-summary__list">
              {summaryRows(step, config).map(([label, value]) => (
                <div key={label} className="acr-setup-summary__row">
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        );
      })}
    </div>
  );
}
