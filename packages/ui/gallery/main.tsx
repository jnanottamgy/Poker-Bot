import { StrictMode, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { CardCode, LegalActions, TournamentStatus as TStatus } from '@jpb/shared-types';
import '../src/styles.css';
import {
  ActionPanel,
  AlertQueue,
  BlindStructureEditor,
  CommandPalette,
  LiveAnnouncerProvider,
  Menu,
  PayoutEditor,
  PlayerDrawer,
  PlayerHeader,
  PlayerLayout,
  TableInspector,
  ActionTimer,
  ActivityFeed,
  AdminShell,
  Alert,
  Badge,
  BlindClock,
  Board,
  Button,
  ChampionOverlay,
  ConfirmDialog,
  ConnectionBanner,
  ControlCard,
  DataTable,
  EliminationCard,
  EmptyState,
  ErrorState,
  HoleCards,
  Icon,
  IconButton,
  Kbd,
  Leaderboard,
  MilestoneBanner,
  Panel,
  PlayerSeat,
  PlayingCard,
  PokerTable,
  PotDisplay,
  ProgressBar,
  SearchInput,
  Select,
  Skeleton,
  Sparkline,
  Spinner,
  StackDisplay,
  StatTile,
  StatusPill,
  TableMap,
  TableMoveCard,
  Tabs,
  TextField,
  Toast,
  Toggle,
  TournamentStatus,
  TournamentStatusPill,
  YourTurnBanner,
  formatChips,
  formatMoneyMinor,
} from '../src';
import type { ActivityEntry, BlindRow, Column, Command, InspectorSeat, LeaderboardRow, NavItem, PayoutRow, QueueAlert, TableSeat, TableTileData, TableTileStatus } from '../src';
import { GEOMETRY_SEATS, GEOMETRY_WIDTHS, busySeats } from './geometry';

/* ------------------------------------------------------------ fixtures -- */

const NOW = Date.now();
const noop = (): void => undefined;

function legal(p: Partial<LegalActions>): LegalActions {
  return {
    seat: 4,
    playerId: 'p4',
    canFold: true,
    canCheck: false,
    canCall: false,
    callAmount: 0,
    canBet: false,
    canRaise: false,
    minTo: 0,
    maxTo: 0,
    canAllIn: false,
    allInTo: 0,
    currentBet: 0,
    contributedThisStreet: 0,
    stack: 31450,
    pot: 9200,
    ...p,
  };
}

const FACING_BET = legal({ canCall: true, callAmount: 1200, canRaise: true, minTo: 2400, maxTo: 31450, canAllIn: true, allInTo: 31450, currentBet: 1200 });
const CHECK_OR_BET = legal({ canCheck: true, canBet: true, minTo: 800, maxTo: 31450, canAllIn: true, allInTo: 31450, pot: 6800 });
const CALL_ALL_IN = legal({ canCall: true, callAmount: 4200, stack: 4200, canAllIn: true, allInTo: 4200, currentBet: 9000, pot: 21000 });
const ALL_IN_ONLY = legal({ canCall: true, callAmount: 1200, stack: 2000, canAllIn: true, allInTo: 2000, maxTo: 2000, minTo: 2000, currentBet: 1200 });

const MOBILE_SEATS: Array<TableSeat | null> = [
  { name: 'Arjun Mehta', stack: 48200, folded: true, lastAction: { action: 'FOLD', amount: 0, toAmount: 0 } },
  { name: 'Sofia Lind', stack: 23950, isButton: true, lastAction: { action: 'CALL', amount: 1200, toAmount: 1200 }, bet: 1200 },
  { name: 'Kenji Watanabe', stack: 112400, isSmallBlind: true, lastAction: { action: 'BET', amount: 1200, toAmount: 1200 }, bet: 1200 },
  { name: 'Priya Raman', stack: 8750, isBigBlind: true, folded: true },
  { name: 'Johnny Kowalski', stack: 31450, holeCards: ['Ah', 'Kh'] },
  { name: 'Marcus Hale', stack: 56100, folded: true, connected: false },
  { name: 'Lena Fischer', stack: 19800, folded: true, away: true },
  null,
  { name: 'Diego Alvarez', stack: 74300, folded: true },
];

const SHOWDOWN_SEATS: Array<TableSeat | null> = [
  { name: 'Arjun Mehta', stack: 48200, folded: true },
  { name: 'Sofia Lind', stack: 0, allIn: true, shownCards: ['Qs', 'Qc'], handDescription: 'Three of a Kind, Queens' },
  { name: 'Kenji Watanabe', stack: 160550, isButton: true, shownCards: ['Jh', 'Th'], winAmount: 48150, handDescription: 'Straight, King high' },
  { name: 'Priya Raman', stack: 8750, folded: true },
  { name: 'Johnny Kowalski', stack: 31450, folded: true, holeCards: ['7c', '2d'] },
  { name: 'Marcus Hale', stack: 56100, isSmallBlind: true, folded: true },
  { name: 'Lena Fischer', stack: 19800, isBigBlind: true, folded: true },
  { name: 'Wei Zhang', stack: 88000, folded: true },
  { name: 'Diego Alvarez', stack: 74300, folded: true },
  { name: 'Hannah Okafor', stack: 41250, folded: true },
];

const SIX_MAX: Array<TableSeat | null> = [
  { name: 'Ava Brooks', stack: 15400, lastAction: { action: 'RAISE', amount: 2200, toAmount: 2400 }, bet: 2400 },
  { name: 'Theo Martins', stack: 88050, isButton: true },
  { name: 'Ines Duarte', stack: 6100, isSmallBlind: true, allIn: true, lastAction: { action: 'ALL_IN', amount: 6100, toAmount: 6500 }, bet: 6500 },
  { name: 'Ravi Kapoor', stack: 41300, isBigBlind: true, bet: 800 },
  null,
  { name: 'Mila Novak', stack: 27700, folded: true, lastAction: { action: 'FOLD', amount: 0, toAmount: 0 } },
];

const FINAL_TABLE: Array<TableSeat | null> = [
  { name: 'Kenji Watanabe', stack: 4_820_000, isButton: true },
  { name: 'Sofia Lind', stack: 2_150_000, isSmallBlind: true, bet: 25000 },
  { name: 'Wei Zhang', stack: 3_400_000, isBigBlind: true, bet: 50000 },
  { name: 'Hannah Okafor', stack: 1_275_000, lastAction: { action: 'CALL', amount: 50000, toAmount: 50000 }, bet: 50000 },
  { name: 'Diego Alvarez', stack: 6_910_000 },
  { name: 'Ava Brooks', stack: 980_000, folded: true },
  { name: 'Theo Martins', stack: 2_640_000, folded: true },
  { name: 'Ravi Kapoor', stack: 3_105_000, lastAction: { action: 'RAISE', amount: 150000, toAmount: 150000 }, bet: 150000 },
  { name: 'Mila Novak', stack: 1_720_000 },
];

const NAMES = ['Kenji Watanabe', 'Diego Alvarez', 'Wei Zhang', 'Ravi Kapoor', 'Theo Martins', 'Sofia Lind', 'Mila Novak', 'Hannah Okafor', 'Ava Brooks', 'Arjun Mehta', 'Lena Fischer', 'Marcus Hale', 'Priya Raman', 'Ines Duarte', 'Johnny Kowalski', 'Noah Becker'];

/** Deterministic pseudo-random (gallery fixtures only; never used for game logic). */
function hash(i: number): number {
  let x = (i + 1) * 2654435761;
  x ^= x >>> 15;
  x = Math.imul(x, 2246822519);
  x ^= x >>> 13;
  return (x >>> 0) / 4294967295;
}

function makeTables(n: number): TableTileData[] {
  const statuses: TableTileStatus[] = ['ACTIVE', 'ACTIVE', 'ACTIVE', 'ACTIVE', 'ACTIVE', 'ACTIVE', 'ACTIVE', 'IDLE', 'HELD', 'BREAKING'];
  return Array.from({ length: n }, (_, i) => {
    const r = hash(i);
    let status = statuses[Math.floor(r * statuses.length)] ?? 'ACTIVE';
    if (i === 36) status = 'STALLED';
    if (i === 140 || i === 141) status = 'CLOSED';
    const players = status === 'CLOSED' ? 0 : status === 'BREAKING' ? 3 + Math.floor(r * 3) : 6 + Math.floor(hash(i + 99) * 4);
    const health = status === 'STALLED' ? 'critical' : hash(i + 7) > 0.93 ? 'warn' : 'ok';
    return {
      id: `t${i + 1}`,
      tableNumber: i + 1,
      players,
      maxSeats: 9,
      status,
      health,
      healthText: status === 'STALLED' ? 'No progress 92s' : status === 'CLOSED' ? 'Closed 21:02' : status === 'HELD' ? 'Held: hand-for-hand' : health === 'warn' ? 'Slow: 41s/hand' : `Hand ${2 + Math.floor(hash(i + 3) * 18)}s ago`,
      handNumber: status === 'CLOSED' ? undefined : 40 + Math.floor(hash(i + 11) * 160),
      averageStack: 30000 + Math.floor(hash(i + 5) * 60000),
      featured: i === 0,
      alerts: status === 'STALLED' ? 2 : 0,
    } satisfies TableTileData;
  });
}

interface PlayerRow {
  id: string;
  name: string;
  publicId: string;
  table: number | null;
  seat: number | null;
  stack: number;
  status: 'SEATED' | 'IN_TRANSIT' | 'ELIMINATED' | 'SUSPENDED';
  connected: boolean;
  timeouts: number;
}

const PLAYERS: PlayerRow[] = Array.from({ length: 14 }, (_, i) => ({
  id: `p${i}`,
  name: NAMES[i % NAMES.length] ?? 'Player',
  publicId: `JPN-${(4096 + i * 977).toString(16).toUpperCase().slice(-4)}`,
  table: i === 4 ? null : 1 + Math.floor(hash(i + 40) * 136),
  seat: i === 4 ? null : Math.floor(hash(i + 41) * 9),
  stack: i === 9 ? 0 : 8000 + Math.floor(hash(i + 42) * 180000),
  status: i === 4 ? 'IN_TRANSIT' : i === 9 ? 'ELIMINATED' : i === 7 ? 'SUSPENDED' : 'SEATED',
  connected: i !== 2 && i !== 9,
  timeouts: i === 2 ? 2 : 0,
}));

const PLAYER_STATUS_PILL: Record<PlayerRow['status'], ReactNode> = {
  // Normal state: plain text, no pill. Colour is reserved for exceptions.
  SEATED: <span style={{ color: 'var(--jpb-text-2)' }}>Seated</span>,
  IN_TRANSIT: <StatusPill size="sm" tone="info" icon="move" label="In transit" />,
  ELIMINATED: <StatusPill size="sm" tone="neutral" icon="x-circle" label="Eliminated" />,
  SUSPENDED: <StatusPill size="sm" tone="warning" icon="pause" label="Suspended" />,
};

const AUDIT: ActivityEntry[] = [
  { id: 'a1', time: '21:14:07', actor: 'system', action: 'INTEGRITY_ALERT', target: 'Table 37', reason: 'No progress for 92s', severity: 'critical' },
  { id: 'a2', time: '21:12:40', actor: 'meera (TD)', action: 'SET_HAND_FOR_HAND', target: 'All tables', reason: 'Bubble: 181 paid, 184 left', severity: 'warning' },
  { id: 'a3', time: '21:09:55', actor: 'system', action: 'MILESTONE', target: '200 players remain', severity: 'gold' },
  { id: 'a4', time: '21:05:12', actor: 'karan (staff)', action: 'ANNOUNCE', target: 'Players', reason: '10 minute break after this level' },
  { id: 'a5', time: '20:58:31', actor: 'meera (TD)', action: 'ADJUST_STACK', target: 'Sofia Lind · T12 S2', reason: 'Dealer miscount verified on camera', severity: 'warning' },
  { id: 'a6', time: '20:51:02', actor: 'system', action: 'TABLE_BROKEN', target: 'Table 141 → 7 players moved' },
];

/* ------------------------------------------------------------- helpers -- */

function Section({ id, eyebrow, title, lede, children }: { id: string; eyebrow: string; title: string; lede?: string; children: ReactNode }) {
  return (
    <section id={id} className="g-section" data-section={id}>
      <p className="g-eyebrow">{eyebrow}</p>
      <h2 className="g-h2">{title}</h2>
      {lede && <p className="g-lede">{lede}</p>}
      {children}
    </section>
  );
}

function H3({ children }: { children: ReactNode }) {
  return <h3 className="g-h3">{children}</h3>;
}

function Swatch({ name, token }: { name: string; token: string }) {
  return (
    <div className="g-swatch">
      <span style={{ background: `var(${token})` }} />
      <b>{name}</b>
      <code>{token}</code>
    </div>
  );
}

function PhoneHeader({ status = 'RUNNING' as TStatus, left = 184 }) {
  return (
    <PlayerHeader
      tournamentName="Spring Showdown"
      status={status}
      playersLeft={left}
      end={<IconButton icon="volume-off" label="Sound off" size="md" />}
      clock={
        <BlindClock
          variant="compact"
          current={{ level: 14, smallBlind: 400, bigBlind: 800, ante: 800 }}
          next={{ level: 15, smallBlind: 500, bigBlind: 1000, ante: 1000 }}
          levelEndsAt={NOW + 271_000}
          serverOffsetMs={0}
        />
      }
    />
  );
}

/* ------------------------------------------------------------ sections -- */

function TokensSection() {
  return (
    <Section id="tokens" eyebrow="Foundations" title="Tokens" lede="Deep charcoal layers, off-white text, one electric green for action, blue for information, gold only for milestones, red only for danger.">
      <H3>Layers & text</H3>
      <div className="g-grid g-grid--kpi">
        <Swatch name="Background" token="--jpb-bg" />
        <Swatch name="Surface" token="--jpb-surface" />
        <Swatch name="Surface 2" token="--jpb-surface-2" />
        <Swatch name="Elevated" token="--jpb-elevated" />
        <Swatch name="Text" token="--jpb-text" />
        <Swatch name="Text 2" token="--jpb-text-2" />
      </div>
      <H3>Meaning</H3>
      <div className="g-grid g-grid--kpi">
        <Swatch name="Accent · action" token="--jpb-accent" />
        <Swatch name="Info" token="--jpb-info" />
        <Swatch name="Gold · milestones" token="--jpb-gold" />
        <Swatch name="Warning" token="--jpb-warning" />
        <Swatch name="Danger" token="--jpb-danger" />
        <Swatch name="Felt" token="--jpb-felt" />
      </div>
      <H3>Type hierarchy</H3>
      <div className="g-card g-stack">
        <div style={{ fontSize: 'var(--jpb-type-huge)', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1 }}>500 LEFT</div>
        <div className="jpb-num" style={{ fontSize: 'var(--jpb-type-large)', fontWeight: 750 }}>
          31,450 <span style={{ color: 'var(--jpb-text-muted)', fontSize: 13 }}>Large · stacks</span>
        </div>
        <div style={{ fontSize: 'var(--jpb-type-medium)', fontWeight: 550 }}>Sofia Lind · Medium · names</div>
        <div style={{ fontSize: 'var(--jpb-type-small)', color: 'var(--jpb-text-2)' }}>Table 42 · Seat 6 · Small · metadata</div>
      </div>
    </Section>
  );
}

function PrimitivesSection() {
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('sofia');
  const [haptics, setHaptics] = useState(true);
  const [sound, setSound] = useState(false);
  return (
    <Section id="primitives" eyebrow="Primitives" title="Controls & feedback">
      <H3>Buttons</H3>
      <div className="g-row">
        <Button variant="primary" icon="play">
          Resume
        </Button>
        <Button>Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger" icon="freeze">
          Emergency freeze
        </Button>
        <Button variant="gold" icon="trophy">
          Crown champion
        </Button>
        <Button variant="primary" loading>
          Save
        </Button>
        <Button disabled>Disabled</Button>
        <Button shortcut="F">FOLD</Button>
      </div>
      <div className="g-row" style={{ marginTop: 12 }}>
        <Button size="sm">Small</Button>
        <Button size="md">Medium</Button>
        <Button size="lg" variant="primary">
          Large
        </Button>
        <Button size="xl" variant="primary" iconRight="arrow-right">
          Extra large
        </Button>
        <IconButton icon="search" label="Search" />
        <IconButton icon="volume" label="Sound on" variant="secondary" pressed />
        <IconButton icon="more" label="More actions" variant="secondary" />
        <span className="g-row" style={{ gap: 4 }}>
          <Kbd>F</Kbd>
          <Kbd>C</Kbd>
          <Kbd>R</Kbd>
          <Kbd>A</Kbd>
        </span>
      </div>
      <H3>Status — icon + text, never colour alone</H3>
      <div className="g-row">
        <StatusPill tone="positive" label="Running" live />
        <StatusPill tone="info" label="Registration open" icon="users" />
        <StatusPill tone="warning" label="On break" icon="coffee" />
        <StatusPill tone="danger" label="Stalled" />
        <StatusPill tone="gold" label="Final table" icon="crown" />
        <StatusPill tone="neutral" label="Closed" icon="lock" />
        <Badge variant="solid" srLabel="Dealer button">
          D
        </Badge>
        <Badge tone="info" srLabel="Small blind">
          SB
        </Badge>
        <Badge tone="info" srLabel="Big blind">
          BB
        </Badge>
        <Badge tone="warning" variant="solid">
          ALL-IN
        </Badge>
        <Badge>FOLDED</Badge>
        <Badge tone="danger">DISCONNECTED</Badge>
      </div>
      <H3>Alerts</H3>
      <div className="g-stack">
        <Alert severity="INFO" title="Break after this level" meta="Announced by Karan · 21:05">
          A 10 minute break starts when level 14 ends.
        </Alert>
        <Alert severity="WARNING" title="Hand-for-hand is active" actions={<Button size="sm">View tables</Button>}>
          184 players remain, 181 are paid. New hands start together on every table.
        </Alert>
        <Alert severity="CRITICAL" title="Table 37 stalled — no progress for 92s" meta="INTEGRITY · T37 · 21:14:07" actions={<Button size="sm" variant="danger">Force timeout</Button>} onDismiss={noop} />
      </div>
      <H3>Inputs</H3>
      <div className="g-grid">
        <TextField label="Display name" placeholder="e.g. Johnny" hint="Shown at the table. 3–20 characters." />
        <TextField label="Stack after adjustment" defaultValue="30000" suffix="chips" inputMode="numeric" error="Must be a whole number of chips" />
        <Select
          label="Hold reason"
          defaultValue="ADMIN"
          options={[
            { value: 'PAUSE', label: 'Pause' },
            { value: 'BREAK', label: 'Break' },
            { value: 'ADMIN', label: 'Director hold' },
          ]}
        />
        <div className="g-stack">
          <SearchInput value={q} onChange={setQ} label="Search players" resultSummary="3 players" />
          <Toggle checked={haptics} onChange={setHaptics} label="Vibrate on your turn" description="Only on supported phones" />
          <Toggle checked={sound} onChange={setSound} label="Sound cues" description="Muted by default" />
        </div>
      </div>
      <H3>Tabs & progress</H3>
      <div className="g-grid g-grid--2">
        <div className="g-card">
          <Tabs
            label="Player filters"
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'all', label: 'All', count: 2000 },
              { id: 'seated', label: 'Seated', count: 1204 },
              { id: 'transit', label: 'In transit', count: 7 },
              { id: 'out', label: 'Eliminated', count: 789 },
            ]}
          />
          <div style={{ marginTop: 16 }}>
            <Tabs label="Range" variant="segmented" value="1h" onChange={noop} tabs={[{ id: '15m', label: '15m' }, { id: '1h', label: '1h' }, { id: 'all', label: 'All' }]} />
          </div>
        </div>
        <div className="g-card g-stack">
          <ProgressBar label="Field remaining" value={1204} max={2000} valueText="1,204 / 2,000" tone="info" />
          <ProgressBar label="Distance to the money" value={184 - 181} max={50} valueText="3 players to the bubble" tone="gold" />
          <div className="g-row">
            <Spinner label="Loading" />
            <Skeleton width={160} />
            <Skeleton shape="circle" width={32} height={32} />
          </div>
        </div>
      </div>
      <H3>Empty & error</H3>
      <div className="g-grid g-grid--2">
        <div className="g-card">
          <EmptyState icon="bell" title="No open alerts" description="Integrity and timing alerts appear here the moment they fire." />
        </div>
        <div className="g-card">
          <ErrorState onRetry={noop} reference="req_7f3a91" />
        </div>
      </div>
    </Section>
  );
}

function CardsSection() {
  const winning: CardCode[] = ['Kd', 'Qh', 'Jh', 'Th', '9s'];
  return (
    <Section id="cards" eyebrow="Poker" title="Cards, board, stacks, timers" lede="Clean white faces, unmistakable suits, labels spoken as “Ace of spades”.">
      <H3>Sizes & states</H3>
      <div className="g-row g-row--top">
        <PlayingCard card="As" size="xl" />
        <PlayingCard card="Kh" size="lg" />
        <PlayingCard card="Td" size="md" />
        <PlayingCard card="7c" size="sm" />
        <PlayingCard card="2s" size="xs" />
        <PlayingCard card={null} size="lg" />
        <PlayingCard card={null} size="md" />
        <PlayingCard card="Qh" size="lg" highlight />
        <PlayingCard card="4c" size="lg" dimmed />
      </div>
      <H3>Four-colour deck</H3>
      <div className="g-row" data-deck="four-color">
        <PlayingCard card="As" size="lg" />
        <PlayingCard card="Kh" size="lg" />
        <PlayingCard card="Qd" size="lg" />
        <PlayingCard card="Jc" size="lg" />
      </div>
      <H3>Board</H3>
      <div className="g-grid g-grid--2">
        <div className="g-card g-stack" style={{ background: 'var(--jpb-felt)' }}>
          <Board cards={[]} />
          <Board cards={['Qh', 'Jd', '4h']} />
          <Board cards={['Qh', 'Jd', '4h', 'Kd']} />
        </div>
        <div className="g-card g-stack" style={{ background: 'var(--jpb-felt)' }}>
          <Board cards={['Kd', 'Qh', 'Jh', 'Th', '4c']} winningCards={winning} size="lg" />
          <div className="g-row">
            <HoleCards cards={['Ah', 'Kh']} size="lg" fanned labelPrefix="Your cards" />
            <HoleCards cards={null} size="sm" />
            <HoleCards cards={['7c', '2d']} size="md" folded />
          </div>
        </div>
      </div>
      <H3>Stacks, pot, timers, clock</H3>
      <div className="g-grid">
        <div className="g-card g-stack">
          <StackDisplay amount={12450} label="Stack" size="lg" bigBlind={800} />
          <StackDisplay amount={999_950} size="md" />
          <StackDisplay amount={1_254_300} size="md" compact={false} />
          <PotDisplay total={48150} pots={[{ amount: 30150 }, { amount: 18000 }]} size="lg" />
        </div>
        <div className="g-card">
          <div className="g-row" style={{ justifyContent: 'space-around' }}>
            <ActionTimer deadline={NOW + 17_400} serverOffsetMs={0} totalMs={20_000} size="lg" announce={false} />
            <ActionTimer deadline={NOW + 9_400} serverOffsetMs={0} totalMs={20_000} size="md" announce={false} />
            <ActionTimer deadline={NOW + 3_600} serverOffsetMs={0} totalMs={20_000} size="md" announce={false} />
          </div>
        </div>
        <BlindClock current={{ level: 14, smallBlind: 400, bigBlind: 800, ante: 800 }} next={{ level: 15, smallBlind: 500, bigBlind: 1000, ante: 1000 }} levelEndsAt={NOW + 271_000} serverOffsetMs={0} />
        <BlindClock current={{ level: 14, smallBlind: 400, bigBlind: 800, ante: 800 }} next={{ level: 15, smallBlind: 500, bigBlind: 1000, ante: 1000 }} levelEndsAt={null} breakEndsAt={NOW + 492_000} serverOffsetMs={0} />
        <BlindClock current={{ level: 14, smallBlind: 400, bigBlind: 800, ante: 800 }} levelEndsAt={null} pausedRemainingMs={271_000} serverOffsetMs={0} />
      </div>
      <H3>Seats</H3>
      <div className="g-row g-row--top" style={{ gap: 28, paddingTop: 24 }}>
        <PlayerSeat name="Johnny Kowalski" stack={31450} hero acting deadline={NOW + 12_000} timerMs={20_000} holeCards={['Ah', 'Kh']} isBigBlind />
        <PlayerSeat name="Sofia Lind" stack={23950} isButton lastAction={{ action: 'CALL', amount: 1200, toAmount: 1200 }} />
        <PlayerSeat name="Ines Duarte" stack={0} allIn lastAction={{ action: 'ALL_IN', amount: 6100, toAmount: 6500 }} />
        <PlayerSeat name="Marcus Hale" stack={56100} folded connected={false} />
        <PlayerSeat name="Lena Fischer" stack={19800} away inHand={false} />
        <PlayerSeat name="Kenji Watanabe" stack={160550} shownCards={['Jh', 'Th']} winAmount={48150} handDescription="Straight, King high" />
      </div>
    </Section>
  );
}

function MobilePlayerSection() {
  return (
    <Section id="player" eyebrow="Player app · mobile" title="Your turn, mid-hand" lede="Portrait table: opponents on the rail, your seat in a dock with large cards, decisions within thumb reach.">
      <div className="g-phones">
        <div className="g-phone-frame">
          <div className="g-phone" data-testid="phone-turn">
            <PhoneHeader />
            <PokerTable
              maxSeats={9}
              seats={MOBILE_SEATS}
              heroSeat={4}
              board={['Qh', 'Jd', '4h']}
              totalPot={9200}
              actingSeat={4}
              actionDeadline={NOW + 14_000}
              timerMs={20_000}
              tableNumber={42}
              handNumber={1284}
              bigBlind={800}
            />
            <ActionPanel legal={FACING_BET} bigBlind={800} onAction={noop} />
          </div>
        </div>
        <div className="g-phone-frame">
          <div className="g-phone">
            <ConnectionBanner state="reconnecting" attempt={2} staleForSeconds={6} />
            <PhoneHeader />
            <div className="jpb-stale">
              <PokerTable
                maxSeats={6}
                seats={SIX_MAX}
                heroSeat={3}
                board={[]}
                totalPot={10_700}
                actingSeat={1}
                actionDeadline={NOW + 9_000}
                timerMs={20_000}
                tableNumber={7}
                handNumber={311}
                bigBlind={800}
              />
            </div>
            <ActionPanel legal={null} bigBlind={800} onAction={noop} />
          </div>
        </div>
        <div className="g-phone-frame">
          <div className="g-phone">
            <PhoneHeader status="FINAL_TABLE" left={9} />
            <PokerTable
              maxSeats={10}
              seats={SHOWDOWN_SEATS}
              heroSeat={4}
              board={['Kd', 'Qh', '9h', '8s', '4c']}
              totalPot={48150}
              pots={[{ amount: 30150 }, { amount: 18000 }]}
              winningCards={['Kd', 'Qh', 'Jh', 'Th', '9h']}
              tableNumber={1}
              handNumber={1291}
              bigBlind={800}
              finalTable
            />
            <ActionPanel legal={null} bigBlind={800} onAction={noop} />
          </div>
        </div>
      </div>
    </Section>
  );
}

/** The real phone screen, laid out by height (screenshot: 390 x 664). */
function FitPage() {
  return (
    <LiveAnnouncerProvider>
      <PlayerLayout
        header={<PhoneHeader />}
        actions={<ActionPanel legal={FACING_BET} bigBlind={800} onAction={noop} />}
      >
        <PokerTable
          maxSeats={9}
          seats={MOBILE_SEATS}
          heroSeat={4}
          board={['Qh', 'Jd', '4h']}
          totalPot={9200}
          actingSeat={4}
          actionDeadline={NOW + 14_000}
          timerMs={20_000}
          tableNumber={42}
          handNumber={1284}
          bigBlind={800}
          dockCardSize="md"
        />
      </PlayerLayout>
    </LiveAnnouncerProvider>
  );
}

function ActionsSection() {
  return (
    <Section id="actions" eyebrow="Player app" title="Action panel states" lede="Everything is derived from the server's LegalActions. Presets: Min, 2x, 2.5x, 3x, All-in, clamped to the legal range.">
      <div className="g-grid g-grid--2">
        <div>
          <p className="g-label">Facing a bet — fold / call / raise</p>
          <ActionPanel legal={FACING_BET} bigBlind={800} onAction={noop} />
        </div>
        <div>
          <p className="g-label">Unopened — check / bet</p>
          <ActionPanel legal={CHECK_OR_BET} bigBlind={800} onAction={noop} />
        </div>
        <div>
          <p className="g-label">Calling puts you all-in</p>
          <ActionPanel legal={CALL_ALL_IN} bigBlind={800} onAction={noop} />
        </div>
        <div>
          <p className="g-label">All-in is the only raise</p>
          <ActionPanel legal={ALL_IN_ONLY} bigBlind={800} onAction={noop} />
        </div>
        <div>
          <p className="g-label">Submitting (server pending)</p>
          <ActionPanel legal={FACING_BET} bigBlind={800} onAction={noop} pending />
        </div>
        <div data-testid="sizer-host">
          <p className="g-label">Sizer (tap RAISE)</p>
          <ActionPanel legal={FACING_BET} bigBlind={800} onAction={noop} keyboardShortcuts={false} />
        </div>
        <div data-testid="confirm-host">
          <p className="g-label">All-in confirmation (tap ALL-IN)</p>
          <ActionPanel legal={ALL_IN_ONLY} bigBlind={800} onAction={noop} keyboardShortcuts={false} confirmAllIn />
        </div>
        <div>
          <p className="g-label">Not your turn (same footprint)</p>
          <ActionPanel legal={null} bigBlind={800} onAction={noop} />
        </div>
      </div>
    </Section>
  );
}

function NoticesSection() {
  return (
    <Section id="notices" eyebrow="Player app" title="Connection & notices" lede="Never show stale data as live. The server holds the truth.">
      <div className="g-stack">
        <ConnectionBanner state="reconnecting" attempt={3} staleForSeconds={12} />
        <ConnectionBanner state="offline" onRetry={noop} staleForSeconds={48} />
        <ConnectionBanner state="session-replaced" onTakeover={noop} />
        <MilestoneBanner title="500 players remain" detail="Average stack 60,000 · Level 11" />
      </div>
      <div className="g-grid g-grid--2" style={{ marginTop: 24 }}>
        <TableMoveCard fromTableNumber={37} fromSeat={3} toTableNumber={42} toSeat={5} stack={12450} onContinue={noop} />
        <EliminationCard finishPosition={184} fieldSize={2000} handsPlayed={212} onWatch={noop} secondaryLabel="Hand history" onSecondary={noop} />
        <EliminationCard finishPosition={57} fieldSize={2000} handsPlayed={388} prizeMinor={2_450_000} currency="INR" onWatch={noop} />
        <div className="g-stack">
          <YourTurnBanner detail="Check or bet" deadline={NOW + 4_200} serverOffsetMs={0} timerMs={20_000} />
          <Leaderboard
            mode="stack"
            totalPlayers={184}
            rows={[
              { id: '1', rank: 1, name: 'Diego Alvarez', stack: 1_480_000, tableNumber: 12 },
              { id: '2', rank: 2, name: 'Kenji Watanabe', stack: 1_210_500, tableNumber: 3 },
              { id: '3', rank: 3, name: 'Wei Zhang', stack: 998_400, tableNumber: 42 },
              { id: '97', rank: 97, name: 'Johnny Kowalski', stack: 31_450, tableNumber: 42, isYou: true },
            ]}
          />
        </div>
      </div>
    </Section>
  );
}

function DesktopTableSection() {
  return (
    <Section id="table" eyebrow="Table" title="Desktop table" lede="Landscape oval, 2–10 seats, hero bottom-centre. Showdown highlights the winning five and the winner.">
      <div className="g-card" style={{ padding: '40px 24px 48px' }}>
        <PokerTable
          variant="wide"
          maxSeats={10}
          seats={SHOWDOWN_SEATS}
          heroSeat={4}
          board={['Kd', 'Qh', '9h', '8s', '4c']}
          totalPot={48150}
          pots={[{ amount: 30150 }, { amount: 18000 }]}
          winningCards={['Kd', 'Qh', 'Jh', 'Th', '9h']}
          tableNumber={12}
          handNumber={1291}
        />
      </div>
      <div className="g-grid g-grid--2" style={{ marginTop: 16 }}>
        <div className="g-card" style={{ padding: '32px 12px 40px' }}>
          <PokerTable variant="wide" maxSeats={6} seats={SIX_MAX} heroSeat={3} board={[]} totalPot={10_700} actingSeat={1} actionDeadline={NOW + 9_000} timerMs={20_000} tableNumber={7} handNumber={311} />
        </div>
        <div className="g-card" style={{ padding: '32px 12px 40px' }}>
          <PokerTable
            variant="wide"
            maxSeats={2}
            seats={[
              { name: 'Diego Alvarez', stack: 14_200_000, isButton: true, isSmallBlind: true, bet: 75000 },
              { name: 'Kenji Watanabe', stack: 15_800_000, isBigBlind: true, bet: 150000 },
            ]}
            heroSeat={null}
            board={[]}
            totalPot={225_000}
            actingSeat={0}
            actionDeadline={NOW + 18_000}
            timerMs={30_000}
            tableNumber={1}
            handNumber={2140}
          />
        </div>
      </div>
      <H3>Phone layout — 2, 6 and 10 seats (variant="tall")</H3>
      <div className="g-phones">
        {[2, 6, 10].map((n) => (
          <div key={n} className="g-phone-frame" style={{ maxWidth: 398 }}>
            <PokerTable variant="tall" maxSeats={n} seats={busySeats(n, 0)} heroSeat={0} board={['Qh', 'Jd', '4h']} totalPot={21_400} actingSeat={2 % n} actionDeadline={NOW + 11_000} timerMs={20_000} tableNumber={n} handNumber={88} bigBlind={800} />
          </div>
        ))}
      </div>
    </Section>
  );
}

function FinalTableSection() {
  const finish: LeaderboardRow[] = [
    { id: 'c', rank: 1, name: 'Diego Alvarez', prizeMinor: 50_000_000 },
    { id: 'r', rank: 2, name: 'Kenji Watanabe', prizeMinor: 32_000_000 },
    { id: 'w', rank: 3, name: 'Wei Zhang', prizeMinor: 21_000_000 },
    { id: 'h', rank: 4, name: 'Ravi Kapoor', prizeMinor: 14_500_000 },
    { id: 's', rank: 5, name: 'Sofia Lind', prizeMinor: 10_000_000 },
  ];
  return (
    <Section id="final" eyebrow="Milestones" title="Final table & champion" lede="Gold appears only here: milestones, the final table and the champion.">
      <div className="g-stack">
        <MilestoneBanner icon="crown" size="lg" title="Final table" detail="9 players remain from 2,000 · Level 24 · 25,000 / 50,000" />
        <div className="g-card" style={{ padding: '40px 24px 48px' }}>
          <PokerTable
            variant="wide"
            maxSeats={9}
            seats={FINAL_TABLE}
            heroSeat={null}
            board={[]}
            totalPot={325_000}
            actingSeat={4}
            actionDeadline={NOW + 22_000}
            timerMs={30_000}
            tableNumber={1}
            handNumber={2088}
            finalTable
          />
        </div>
        <H3>Final table on a phone (gold rail)</H3>
        <div className="g-phones">
          <div className="g-phone-frame" style={{ maxWidth: 398 }}>
            <PokerTable variant="tall" maxSeats={9} seats={FINAL_TABLE} heroSeat={7} board={['Ac', '7d', '7s']} totalPot={325_000} actingSeat={4} actionDeadline={NOW + 22_000} timerMs={30_000} tableNumber={1} handNumber={2088} bigBlind={50_000} finalTable />
          </div>
        </div>
        <div className="g-grid g-grid--2">
          <Leaderboard
            mode="stack"
            rows={[...FINAL_TABLE]
              .filter((s): s is TableSeat => s !== null)
              .sort((a, b) => b.stack - a.stack)
              .slice(0, 6)
              .map((s, i) => ({ id: s.name, rank: i + 1, name: s.name, stack: s.stack }))}
            totalPlayers={9}
          />
          <Leaderboard mode="finish" rows={finish} currency="INR" />
        </div>
        <ChampionOverlay position="inline" name="Diego Alvarez" stack={30_000_000} playersInField={2000} prizeMinor={50_000_000} currency="INR" tournamentName="Spring Showdown 2026" onClose={noop} />
      </div>
    </Section>
  );
}

const NAV: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: 'grid', group: 'Live' },
  { id: 'tables', label: 'Tables', icon: 'layers', group: 'Live', badge: 1, badgeTone: 'danger' },
  { id: 'players', label: 'Players', icon: 'users', group: 'Live' },
  { id: 'clock', label: 'Clock & levels', icon: 'clock', group: 'Live' },
  { id: 'moves', label: 'Seating & moves', icon: 'move', group: 'Live', badge: 7 },
  { id: 'alerts', label: 'Alerts', icon: 'bell', group: 'Integrity', badge: 3, badgeTone: 'danger' },
  { id: 'fairness', label: 'Fairness', icon: 'shield', group: 'Integrity' },
  { id: 'audit', label: 'Audit log', icon: 'file', group: 'Integrity' },
  { id: 'hands', label: 'Hand history', icon: 'list', group: 'Integrity' },
  { id: 'structure', label: 'Structure & payouts', icon: 'award', group: 'Setup' },
  { id: 'announce', label: 'Announcements', icon: 'message', group: 'Setup' },
  { id: 'staff', label: 'Staff & roles', icon: 'key', group: 'Setup' },
  { id: 'sim', label: 'Simulation', icon: 'activity', group: 'Setup' },
  { id: 'settings', label: 'Settings', icon: 'sliders', group: 'Setup' },
];

const ALERTS: QueueAlert[] = [
  { id: 'al1', severity: 'critical', code: 'STALLED_TABLE', title: 'Table 37 stalled — no hand progress', source: 'Table 37', detail: 'Seat 4 (Marcus Hale) disconnected mid-decision; timer did not fire.', raisedAt: NOW - 92_000, state: 'open', owner: null },
  { id: 'al2', severity: 'critical', code: 'STATE_DESYNC', title: 'Node gs-3 version gap on 2 tables', source: 'gs-3', raisedAt: NOW - 41_000, state: 'open', owner: 'Karan' },
  { id: 'al3', severity: 'warning', code: 'SLOW_TABLE', title: 'Table 12 averaging 41s per hand', source: 'Table 12', raisedAt: NOW - 260_000, state: 'open', owner: null },
  { id: 'al4', severity: 'info', code: 'LATE_REG_CLOSING', title: 'Late registration closes in 5 minutes', raisedAt: NOW - 30_000, state: 'acked', owner: 'Meera' },
];

const STAFF = [
  { id: 's1', name: 'Meera Iyer (TD)' },
  { id: 's2', name: 'Karan Shah (floor)' },
  { id: 's3', name: 'Ana Ruiz (floor)' },
];

const INSPECT_SEATS: Array<InspectorSeat | null> = [
  { playerId: 'p1', name: 'Arjun Mehta', stack: 48_200, privateCards: ['9c', '9d'], lastAction: { action: 'CALL', amount: 1200, toAmount: 1200 }, bet: 1200 },
  { playerId: 'p2', name: 'Sofia Lind', stack: 23_950, isButton: true, privateCards: ['Ah', 'Qh'], lastAction: { action: 'RAISE', amount: 3600, toAmount: 4800 }, bet: 4800 },
  { playerId: 'p3', name: 'Kenji Watanabe', stack: 112_400, isSmallBlind: true, folded: true },
  { playerId: 'p4', name: 'Priya Raman', stack: 8750, isBigBlind: true, folded: true },
  { playerId: 'p5', name: 'Marcus Hale', stack: 56_100, connected: false, privateCards: ['Kc', 'Js'] },
  { playerId: 'p6', name: 'Lena Fischer', stack: 19_800, folded: true, away: true, sittingOut: true },
  null,
  { playerId: 'p8', name: 'Diego Alvarez', stack: 74_300, folded: true },
  { playerId: 'p9', name: 'Wei Zhang', stack: 88_000, folded: true },
];

const BLINDS: BlindRow[] = [
  { key: 'l12', smallBlind: 250, bigBlind: 500, ante: 500, durationMin: 20 },
  { key: 'l13', smallBlind: 300, bigBlind: 600, ante: 600, durationMin: 20 },
  { key: 'l14', smallBlind: 400, bigBlind: 800, ante: 800, durationMin: 20 },
  { key: 'br', isBreak: true, smallBlind: 0, bigBlind: 0, ante: 0, durationMin: 10 },
  { key: 'l15', smallBlind: 500, bigBlind: 1000, ante: 1000, durationMin: 20 },
  { key: 'l16', smallBlind: 600, bigBlind: 900, ante: 1200, durationMin: 20 },
];

const PAYOUTS: PayoutRow[] = [
  { key: 'p1', fromPlace: 1, toPlace: 1, bpEach: 2500 },
  { key: 'p2', fromPlace: 2, toPlace: 2, bpEach: 1600 },
  { key: 'p3', fromPlace: 3, toPlace: 3, bpEach: 1050 },
  { key: 'p4', fromPlace: 4, toPlace: 9, bpEach: 600 },
  { key: 'p5', fromPlace: 10, toPlace: 18, bpEach: 150 },
];

let keySeq = 100;
const nextKey = (): string => `k${keySeq++}`;

function directorCommands(open: (what: string) => void): Command[] {
  return [
    { id: 'pause', label: 'Pause tournament after this hand', group: 'Tournament', icon: 'pause', shortcut: '⇧P', run: () => open('pause') },
    { id: 'break', label: 'Start break', group: 'Tournament', icon: 'coffee', shortcut: '⇧B', run: () => open('break') },
    { id: 'h4h', label: 'Toggle hand-for-hand', group: 'Tournament', icon: 'pause', shortcut: '⇧H', run: () => open('h4h') },
    { id: 'clock+', label: 'Add 1 minute to the level', group: 'Clock', icon: 'plus', shortcut: ']', run: () => open('clock+') },
    { id: 'clock-', label: 'Remove 1 minute from the level', group: 'Clock', icon: 'minus', shortcut: '[', run: () => open('clock-') },
    { id: 'next', label: 'Advance to next level', group: 'Clock', icon: 'skip-forward', shortcut: '⇧N', danger: true, run: () => open('next') },
    { id: 'table', label: 'Open table…', group: 'Tables', icon: 'layers', shortcut: 'T', keywords: ['inspect', 'goto'], run: () => open('table') },
    { id: 'rebalance', label: 'Rebalance tables now', group: 'Tables', icon: 'refresh', run: () => open('rebalance') },
    { id: 'break-table', label: 'Break a table…', group: 'Tables', icon: 'split', danger: true, run: () => open('break-table') },
    { id: 'find', label: 'Find player…', group: 'Players', icon: 'search', shortcut: '/', keywords: ['search'], run: () => open('find') },
    { id: 'adjust', label: 'Adjust a stack…', group: 'Players', icon: 'sliders', danger: true, keywords: ['chips'], disabledReason: 'Requires STACK_ADJUST', run: () => open('adjust') },
    { id: 'announce', label: 'Announce to all players', group: 'Communication', icon: 'message', shortcut: 'A', run: () => open('announce') },
    { id: 'alerts', label: 'Go to alerts', group: 'Integrity', icon: 'bell', shortcut: 'G A', run: () => open('alerts') },
    { id: 'audit', label: 'Export audit log', group: 'Integrity', icon: 'download', run: () => open('audit') },
    { id: 'freeze', label: 'Emergency freeze', group: 'Emergency', icon: 'freeze', danger: true, shortcut: '⇧⌘F', run: () => open('freeze') },
    { id: 'cancel', label: 'Cancel tournament', group: 'Emergency', icon: 'ban', danger: true, run: () => open('cancel') },
  ];
}

function AdminSection() {
  const tables = useMemo(() => makeTables(160), []);
  const [selected, setSelected] = useState<string | null>('t37');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [h4h, setH4h] = useState(true);
  const [checked, setChecked] = useState<string[]>(['p2', 'p5', 'p11']);
  const [palette, setPalette] = useState(false);
  const [blinds, setBlinds] = useState(BLINDS);
  const [payouts, setPayouts] = useState(PAYOUTS);
  const columns: Column<PlayerRow>[] = [
    {
      key: 'name',
      header: 'Player',
      sortValue: (r) => r.name,
      render: (r) => (
        <span style={{ display: 'grid' }}>
          <span style={{ fontWeight: 600 }}>{r.name}</span>
          <span style={{ color: 'var(--jpb-text-muted)', fontSize: 12 }}>{r.publicId}</span>
        </span>
      ),
    },
    { key: 'status', header: 'Status', render: (r) => PLAYER_STATUS_PILL[r.status] },
    { key: 'table', header: 'Table / seat', render: (r) => (r.table === null ? '—' : `T${r.table} · S${(r.seat ?? 0) + 1}`), sortValue: (r) => r.table ?? 0 },
    { key: 'stack', header: 'Stack', numeric: true, sortValue: (r) => r.stack, render: (r) => formatChips(r.stack) },
    {
      key: 'conn',
      header: 'Connection',
      render: (r) =>
        r.connected ? (
          <span style={{ color: 'var(--jpb-text-2)' }}>Online</span>
        ) : (
          <span style={{ color: 'var(--jpb-danger)' }}>
            <Icon name="wifi-off" /> Offline{r.timeouts ? ` · ${r.timeouts} timeouts` : ''}
          </span>
        ),
    },
  ];
  return (
    <section id="admin" data-section="admin" className="g-section g-solo-admin">
      <AdminShell
        nav={NAV}
        activeId="overview"
        onNavigate={noop}
        title="Spring Showdown 2026 — Control room"
        subtitle="T-7F3A · Director view"
        clock={<BlindClock variant="bar" current={{ level: 14, smallBlind: 400, bigBlind: 800, ante: 800 }} levelEndsAt={NOW + 271_000} serverOffsetMs={0} />}
        status={
          <>
            <TournamentStatusPill status="RUNNING" />
            <StatusPill tone="warning" icon="pause" label="Hand-for-hand" />
          </>
        }
        actions={
          <>
            <Button size="sm" variant="ghost" icon="search" onClick={() => setPalette(true)} aria-keyshortcuts="Control+K Meta+K">
              Commands <Kbd>⌘K</Kbd>
            </Button>
            <Button size="sm" icon="message">
              Announce
            </Button>
            <Button size="sm" variant="danger-outline" icon="freeze">
              Freeze…
            </Button>
          </>
        }
        user={{ name: 'Meera Iyer', role: 'TOURNAMENT_DIRECTOR' }}
        banner={
          <Alert
            severity="CRITICAL"
            title="Table 37 stalled — no hand progress for 92s"
            meta="INTEGRITY · STALLED_TABLE · first seen 21:14:07"
            actions={
              <>
                <Button size="sm" onClick={() => setSelected('t37')}>
                  Open table
                </Button>
                <Button size="sm" variant="danger-outline">
                  Force timeout
                </Button>
              </>
            }
          />
        }
      >
        <div className="g-stack" style={{ gap: 16 }}>
          <div className="jpb-kpis">
            <StatTile label="Players left" icon="users" value="1,204" unit="/ 2,000" delta={{ text: '-38', direction: 'down', good: true, context: 'last 10 min' }} spark={[2000, 1900, 1760, 1600, 1480, 1390, 1300, 1242, 1204]} sparkTone="info" />
            <StatTile label="Active tables" icon="layers" value="136" delta={{ text: '-4', direction: 'down', good: true, context: 'broken' }} spark={[223, 210, 190, 176, 160, 150, 141, 140, 136]} />
            <StatTile label="Average stack" icon="activity" value="49,834" unit="62 BB" delta={{ text: '+1,604', direction: 'up' }} />
            <StatTile label="Hands / min" icon="zap" value="412" delta={{ text: '-6%', direction: 'down', good: false, context: 'vs 1h avg' }} spark={[440, 452, 438, 446, 431, 425, 419, 412]} sparkTone="warning" />
            <StatTile label="Largest pot" icon="trophy" value="1,204,500" hint="T12 · hand #1291" />
            <StatTile label="Open alerts" icon="bell" value="3" tone="danger" delta={{ text: '2 critical', direction: 'flat' }} />
          </div>
          <div className="g-admin-grid">
            <Panel
              fill
              title="Table map"
              icon="grid"
              description="136 active · tap a status to filter · windowed (only visible rows render)"
              actions={
                <>
                  <Button size="sm" icon="refresh">
                    Rebalance now
                  </Button>
                  <Button size="sm" variant="ghost" icon="download">
                    Export
                  </Button>
                </>
              }
            >
              <TableMap tables={tables} selectedId={selected} onSelect={setSelected} height={900} />
            </Panel>
            <div className="g-controls">
              <ControlCard title="Tournament" icon="play" description="Lifecycle and pauses" state="Running · started 18:00 · 3h 14m elapsed">
                <Button size="sm" icon="pause">
                  Pause after hand
                </Button>
                <Button size="sm" icon="coffee">
                  Start break
                </Button>
                <Button size="sm" variant="ghost" icon="lock">
                  Close late reg
                </Button>
              </ControlCard>
              <ControlCard title="Blind clock" icon="clock" state="Level 14 · next 500 / 1,000 (1,000)">
                <div className="g-bigclock">
                  <BlindClock variant="bar" current={{ level: 14, smallBlind: 400, bigBlind: 800, ante: 800 }} levelEndsAt={NOW + 271_000} serverOffsetMs={0} className="g-bigclock__clock" />
                </div>
                <Button size="sm" icon="minus">
                  1 min
                </Button>
                <Button size="sm" icon="plus">
                  1 min
                </Button>
                <Button size="sm" icon="skip-forward">
                  Next level…
                </Button>
                <Button size="sm" variant="ghost">
                  Set level…
                </Button>
              </ControlCard>
              <ControlCard title="Tables" icon="layers" state="136 tables · max imbalance 2 · 7 players in transit">
                <Toggle checked={h4h} onChange={setH4h} label="Hand-for-hand" description="All tables start hands together" />
                <Button size="sm" icon="split">
                  Break table 37…
                </Button>
                <Button size="sm" variant="ghost" icon="move">
                  Move player…
                </Button>
              </ControlCard>
              <ControlCard title="Stack adjustment" icon="sliders" description="Correct a verified chip error" lockedPermission="STACK_ADJUST">
                <Button size="sm">Adjust stack…</Button>
              </ControlCard>
              <ControlCard title="Emergency" icon="critical" tone="danger" description="Freeze stops every timer and action instantly">
                <Button size="sm" variant="danger" icon="freeze">
                  Emergency freeze
                </Button>
                <Button size="sm" variant="danger-outline" icon="ban">
                  Cancel tournament…
                </Button>
              </ControlCard>
            </div>
          </div>
          <div className="g-admin-grid">
            <Panel title="Table 37 — live" icon="layers" description="Seat menus: open, message, move, adjust, sit out / in, force timeout, eliminate">
              <TableInspector
                tableNumber={37}
                status="STALLED"
                maxSeats={9}
                seats={INSPECT_SEATS}
                board={['Qh', 'Jd', '4h']}
                totalPot={14_700}
                handNumber={212}
                actingSeat={4}
                actionDeadline={NOW - 1000}
                timerMs={20_000}
                revealed
                locked={{ eliminate: 'PLAYER_ELIMINATE' }}
                details={[
                  { label: 'Last hand', value: '92s ago' },
                  { label: 'Dealer', value: 'Seat 2' },
                  { label: 'Node', value: 'gs-3', mono: true },
                ]}
                onSeatAction={noop}
                onTableAction={noop}
              />
            </Panel>
            <Panel title="Alert queue" icon="bell" description="Ack, assign or snooze. Critical first, then oldest.">
              <AlertQueue alerts={ALERTS} now={NOW} staff={STAFF} onAck={noop} onAssign={noop} onSnooze={noop} onOpen={noop} />
            </Panel>
          </div>
          <div className="g-admin-grid">
            <Panel title="Players" icon="users" flush actions={<SearchInput value={q} onChange={setQ} label="Search players" placeholder="Name, JPN id, table…" />}>
              <div style={{ padding: '0 16px' }}>
                <Tabs
                  label="Player status"
                  value={tab}
                  onChange={setTab}
                  tabs={[
                    { id: 'all', label: 'All', count: 2000 },
                    { id: 'seated', label: 'Seated', count: 1204 },
                    { id: 'transit', label: 'In transit', count: 7 },
                    { id: 'out', label: 'Eliminated', count: 789 },
                    { id: 'susp', label: 'Suspended', count: 2 },
                  ]}
                />
              </div>
              <DataTable
                label="Players"
                columns={columns}
                rows={PLAYERS}
                rowKey={(r) => r.id}
                rowLabel={(r) => r.name}
                onRowActivate={noop}
                selectedKey="p5"
                checkedKeys={checked}
                onCheckedChange={setChecked}
                bulkActions={() => (
                  <>
                    <Button size="sm" icon="move">
                      Move…
                    </Button>
                    <Button size="sm" icon="message">
                      Message
                    </Button>
                    <Button size="sm" icon="pause">
                      Sit out
                    </Button>
                    <Button size="sm" variant="danger-outline" icon="ban">
                      Disqualify…
                    </Button>
                  </>
                )}
                rowActions={(r) => [
                  { id: 'open', label: 'Open player', icon: 'user', onSelect: noop },
                  { id: 'msg', label: 'Message', icon: 'message', onSelect: noop },
                  { id: 'move', label: 'Move…', icon: 'move', onSelect: noop, disabled: r.status === 'ELIMINATED', disabledReason: 'Player is eliminated' },
                  { id: 'adj', label: 'Adjust stack…', icon: 'sliders', onSelect: noop, disabled: true, disabledReason: 'Requires STACK_ADJUST' },
                  'separator',
                  { id: 'dq', label: 'Disqualify…', icon: 'ban', danger: true, onSelect: noop },
                ]}
                pagination={{ page, pageSize, total: 2000, onPageChange: setPage, pageSizeOptions: [25, 50, 100, 200], onPageSizeChange: setPageSize }}
                density="compact"
              />
            </Panel>
            <Panel title="Audit log" icon="file" description="Every override carries an actor and a reason" actions={<Button size="sm" variant="ghost">View all</Button>}>
              <ActivityFeed entries={AUDIT} label="Recent audit events" />
            </Panel>
          </div>
          <div className="g-admin-grid g-admin-grid--even">
            <Panel title="Blind structure" icon="clock" description="Levels already played are locked. Every row is validated before it can be saved." actions={<Button size="sm" variant="primary" disabled>Save structure</Button>}>
              <BlindStructureEditor rows={blinds} onChange={setBlinds} currentLevel={3} newKey={nextKey} />
            </Panel>
            <Panel title="Payouts" icon="award" description="Per-place share in hundredths of a percent; must total exactly 100.00%.">
              <PayoutEditor rows={payouts} onChange={setPayouts} prizePoolMinor={200_000_000} formatMoney={(m) => formatMoneyMinor(m, 'INR')} paidPlaces={18} newKey={nextKey} />
            </Panel>
          </div>
        </div>
      </AdminShell>
      <CommandPalette open={palette} onClose={() => setPalette(false)} commands={directorCommands(noop)} />
    </section>
  );
}

/** Command palette, open (screenshot). */
function PaletteSection() {
  return (
    <Section id="palette" eyebrow="Admin" title="Command palette" lede="⌘K lists every director action with its key hint. Destructive commands open their confirmation; locked ones say which permission is missing.">
      <CommandPalette open onClose={noop} commands={directorCommands(noop)} />
    </Section>
  );
}

function DialogsSection() {
  return (
    <Section id="dialogs" eyebrow="Admin" title="Dialogs, drawers, toasts" lede="Dangerous operations need two confirmations: a typed word and a reason for the audit log, with the consequences and a before → after preview.">
      <div className="g-grid g-grid--2">
        <ConfirmDialog
          inline
          open
          title="Adjust stack"
          summary="Sofia Lind · Table 12 · Seat 2 · between hands"
          consequences={['The stack changes immediately and is visible to the table.', 'Table and tournament chip totals change by +6,050.', 'An ADJUST_STACK audit record is written with your name and reason.']}
          preview={[
            { label: 'Stack', before: '23,950', after: '30,000' },
            { label: 'Table 12 chips', before: '412,600', after: '418,650' },
            { label: 'Tournament chips', before: '60,000,000', after: '60,006,050' },
          ]}
          confirmWord="ADJUST"
          onConfirm={noop}
          onCancel={noop}
        />
        <PlayerDrawer
          inline
          open
          onClose={noop}
          onAction={noop}
          locked={{ disqualify: 'PLAYER_DISQUALIFY' }}
          player={{ name: 'Sofia Lind', publicId: 'JPN-7A42', status: 'SEATED', connected: true, stack: 23_950, bigBlind: 800, tableNumber: 12, seat: 1, consecutiveTimeouts: 1 }}
          details={[
            { label: 'Registered', value: '17:42:10' },
            { label: 'Hands played', value: '212' },
            { label: 'Hands since BB', value: '3' },
            { label: 'Device', value: 'iPhone · Safari' },
            { label: 'Session', value: 'sess_91fa…c02', mono: true },
          ]}
        >
          <Tabs label="Player detail" value="hands" onChange={noop} tabs={[{ id: 'hands', label: 'Hands' }, { id: 'moves', label: 'Moves', count: 2 }, { id: 'audit', label: 'Audit', count: 1 }]} />
          <ActivityFeed entries={AUDIT.slice(4, 6)} />
        </PlayerDrawer>
      </div>
      <H3>Menus</H3>
      <div className="g-row" style={{ minHeight: 60 }}>
        <Menu label="Actions for Sofia Lind" triggerText="Row menu" items={[{ id: 'a', label: 'Open player', icon: 'user', onSelect: noop }, { id: 'b', label: 'Adjust stack…', icon: 'sliders', disabled: true, disabledReason: 'Requires STACK_ADJUST', onSelect: noop }, 'separator', { id: 'c', label: 'Disqualify…', icon: 'ban', danger: true, onSelect: noop }]} align="start" />
      </div>
      <H3>Toasts</H3>
      <div className="g-stack" style={{ maxWidth: 420 }}>
        <Toast id={1} tone="success" title="Break started" description="All tables held. Resumes at 21:30." onDismiss={noop} durationMs={0} />
        <Toast id={2} tone="warning" title="7 players in transit" description="Moves complete when their current hands end." onDismiss={noop} action={{ label: 'View', onClick: noop }} />
        <Toast id={3} tone="danger" title="Action rejected: STALE_STATE_VERSION" description="The table moved on. Your screen has been refreshed." onDismiss={noop} />
        <Toast id={4} tone="gold" title="Final table formed" description="Table 1 · 9 players" onDismiss={noop} durationMs={0} />
      </div>
    </Section>
  );
}

function BroadcastSection() {
  const top: LeaderboardRow[] = [
    { id: '1', rank: 1, name: 'Diego Alvarez', stack: 1_480_000 },
    { id: '2', rank: 2, name: 'Kenji Watanabe', stack: 1_210_500 },
    { id: '3', rank: 3, name: 'Wei Zhang', stack: 998_400 },
    { id: '4', rank: 4, name: 'Ravi Kapoor', stack: 912_000 },
    { id: '5', rank: 5, name: 'Theo Martins', stack: 880_250, tied: true },
    { id: '6', rank: 5, name: 'Sofia Lind', stack: 880_250, tied: true },
    { id: '7', rank: 7, name: 'Mila Novak', stack: 812_900 },
    { id: '8', rank: 8, name: 'Hannah Okafor', stack: 774_100 },
    { id: '9', rank: 9, name: 'Ava Brooks', stack: 706_300 },
  ];
  return (
    <Section id="broadcast" eyebrow="Projector" title="Broadcast display" lede="Readable from the back of the room.">
      <div className="g-broadcast">
        <TournamentStatus size="broadcast" name="Spring Showdown 2026" status="RUNNING" playersRemaining={184} playersTotal={2000} tables={21} level={14} averageStack={326_087} prizePool={formatMoneyMinor(200_000_000, 'INR')} handForHand />
        <div className="g-broadcast-grid">
          <div className="g-stack" style={{ gap: 24 }}>
            <BlindClock variant="broadcast" current={{ level: 14, smallBlind: 400, bigBlind: 800, ante: 800 }} next={{ level: 15, smallBlind: 500, bigBlind: 1000, ante: 1000 }} levelEndsAt={NOW + 271_000} serverOffsetMs={0} />
            <figure className="g-spark">
              <figcaption>Players remaining · last 60 min</figcaption>
              <Sparkline data={[2000, 1700, 1300, 950, 640, 420, 300, 230, 184]} tone="info" width={480} height={64} label="Players remaining over the last 60 minutes, falling from 2,000 to 184" />
            </figure>
          </div>
          <Leaderboard size="broadcast" mode="stack" rows={top} totalPlayers={184} compactStacks={false} />
        </div>
        <MilestoneBanner size="broadcast" title="The money bubble has burst" detail="181 players are now guaranteed a prize" icon="award" />
      </div>
    </Section>
  );
}

/** Every tall table size at three phone widths (checked for overlaps by screenshot.mjs). */
function GeometrySection() {
  const mode = new URLSearchParams(window.location.search).get('mode') ?? 'hand';
  return (
    <Section id="geometry" eyebrow="Table" title="Tall geometry" lede="2–10 seats at 328 / 358 / 398px. No seat box may touch the board or another box.">
      <div className="g-geom">
        {GEOMETRY_SEATS.map((n) =>
          GEOMETRY_WIDTHS.map((w) => (
            <div key={`${n}-${w}`} className="g-geom__cell" style={{ width: w }} data-geom={`${n}@${w}`}>
              <p className="g-label">
                {n} seats · {w}px · {mode}
              </p>
              <PokerTable
                variant="tall"
                maxSeats={n}
                seats={busySeats(n, mode === 'spectator' ? null : 0, mode === 'showdown')}
                heroSeat={mode === 'spectator' ? null : 0}
                board={['Qh', 'Jd', '4h', 'Kd', '9s']}
                totalPot={48_150}
                actingSeat={mode === 'hand' ? 2 % n : null}
                actionDeadline={NOW + 12_000}
                timerMs={20_000}
                tableNumber={42}
                handNumber={1284}
                bigBlind={800}
              />
            </div>
          )),
        )}
      </div>
      <div className="g-row g-row--top" style={{ marginTop: 24 }}>
        <div style={{ width: 366 }} data-compare="tall">
          <PokerTable variant="tall" maxSeats={9} seats={MOBILE_SEATS} heroSeat={4} board={['Qh', 'Jd', '4h']} totalPot={9200} actingSeat={4} tableNumber={42} handNumber={1284} bigBlind={800} />
        </div>
        <div style={{ width: 366 }} data-compare="auto">
          <PokerTable variant="auto" maxSeats={9} seats={MOBILE_SEATS} heroSeat={4} board={['Qh', 'Jd', '4h']} totalPot={9200} actingSeat={4} tableNumber={42} handNumber={1284} bigBlind={800} />
        </div>
        <div style={{ width: 366 }} data-compare="wide">
          <PokerTable variant="wide" maxSeats={9} seats={MOBILE_SEATS} heroSeat={4} board={['Qh', 'Jd', '4h']} totalPot={9200} actingSeat={4} tableNumber={42} handNumber={1284} bigBlind={800} />
        </div>
      </div>
    </Section>
  );
}

const SECTIONS: Array<{ id: string; label: string; el: () => ReactNode }> = [
  { id: 'tokens', label: 'Tokens', el: () => <TokensSection /> },
  { id: 'primitives', label: 'Primitives', el: () => <PrimitivesSection /> },
  { id: 'cards', label: 'Cards & seats', el: () => <CardsSection /> },
  { id: 'player', label: 'Mobile player', el: () => <MobilePlayerSection /> },
  { id: 'actions', label: 'Action panel', el: () => <ActionsSection /> },
  { id: 'notices', label: 'Notices', el: () => <NoticesSection /> },
  { id: 'table', label: 'Desktop table', el: () => <DesktopTableSection /> },
  { id: 'final', label: 'Final table', el: () => <FinalTableSection /> },
  { id: 'admin', label: 'Admin', el: () => <AdminSection /> },
  { id: 'dialogs', label: 'Dialogs', el: () => <DialogsSection /> },
  { id: 'broadcast', label: 'Broadcast', el: () => <BroadcastSection /> },
  { id: 'palette', label: 'Palette', el: () => <PaletteSection /> },
  { id: 'geometry', label: 'Geometry', el: () => <GeometrySection /> },
];

function Gallery() {
  const params = new URLSearchParams(window.location.search);
  const only = params.get('section');
  const [contrast, setContrast] = useState(params.get('contrast') === 'high');
  const [deck, setDeck] = useState(params.get('deck') === 'four-color');
  const [reduced, setReduced] = useState(params.get('motion') === 'reduced');
  const root = document.documentElement;
  if (contrast) root.dataset.contrast = 'high';
  else delete root.dataset.contrast;
  if (deck) root.dataset.deck = 'four-color';
  else delete root.dataset.deck;
  if (reduced) root.dataset.motion = 'reduced';
  else delete root.dataset.motion;

  const shown = only ? SECTIONS.filter((s) => s.id === only) : SECTIONS;
  if (only === 'admin') return <>{shown.map((s) => <div key={s.id}>{s.el()}</div>)}</>;
  if (only === 'fit') return <FitPage />;
  return (
    <div className={only ? 'g-solo' : undefined}>
      {!only && (
        <nav className="g-nav" aria-label="Gallery sections">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`?section=${s.id}`}>
              {s.label}
            </a>
          ))}
          <span className="g-toggles">
            <button type="button" aria-pressed={contrast} onClick={() => setContrast((v) => !v)}>
              High contrast
            </button>
            <button type="button" aria-pressed={deck} onClick={() => setDeck((v) => !v)}>
              4-colour deck
            </button>
            <button type="button" aria-pressed={reduced} onClick={() => setReduced((v) => !v)}>
              Reduced motion
            </button>
          </span>
        </nav>
      )}
      <div className="g-wrap">
        {shown.map((s) => (
          <div key={s.id}>{s.el()}</div>
        ))}
      </div>
    </div>
  );
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <Gallery />
    </StrictMode>,
  );
}
