import { StrictMode, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { CardCode, LegalActions, TournamentStatus as TStatus } from '@jpb/shared-types';
import '../src/styles.css';
import {
  ActionPanel,
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
  DescriptionList,
  EliminationCard,
  EmptyState,
  ErrorState,
  HoleCards,
  Icon,
  IconButton,
  Kbd,
  Leaderboard,
  MilestoneBanner,
  Modal,
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
import type { ActivityEntry, Column, LeaderboardRow, NavItem, TableSeat, TableTileData, TableTileStatus } from '../src';

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

const PLAYERS: PlayerRow[] = Array.from({ length: 12 }, (_, i) => ({
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
  SEATED: <StatusPill size="sm" tone="positive" label="Seated" />,
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
    <>
      <div className="g-ptop">
        <span className="g-brand">
          <i>♠</i> Spring Showdown
        </span>
        <span className="g-row" style={{ gap: 8 }}>
          <TournamentStatusPill status={status} size="sm" />
          <IconButton icon="volume-off" label="Sound off" size="sm" />
        </span>
      </div>
      <BlindClock
        variant="compact"
        current={{ level: 14, smallBlind: 400, bigBlind: 800, ante: 800 }}
        next={{ level: 15, smallBlind: 500, bigBlind: 1000, ante: 1000 }}
        levelEndsAt={NOW + 271_000}
        serverOffsetMs={0}
      />
      <p className="jpb-sr-only">{left} players left</p>
    </>
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
      </div>
    </Section>
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
  { id: 'payouts', label: 'Payouts', icon: 'award', group: 'Setup' },
  { id: 'announce', label: 'Announcements', icon: 'message', group: 'Setup' },
  { id: 'staff', label: 'Staff & roles', icon: 'key', group: 'Setup' },
  { id: 'sim', label: 'Simulation', icon: 'activity', group: 'Setup' },
  { id: 'settings', label: 'Settings', icon: 'sliders', group: 'Setup' },
];

function AdminSection() {
  const tables = useMemo(() => makeTables(160), []);
  const [selected, setSelected] = useState<string | null>('t37');
  const [page, setPage] = useState(0);
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [h4h, setH4h] = useState(true);
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
          <span style={{ color: 'var(--jpb-text-2)' }}>
            <Icon name="wifi" /> Online
          </span>
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
        subtitle="T-7F3A · Director view · Level 14 · 400 / 800 (ante 800)"
        status={
          <>
            <TournamentStatusPill status="RUNNING" />
            <StatusPill tone="warning" icon="pause" label="Hand-for-hand" />
            <StatusPill tone="positive" icon="wifi" label="All nodes healthy" />
          </>
        }
        actions={
          <>
            <Button size="sm" icon="message">
              Announce
            </Button>
            <Button size="sm" variant="danger" icon="freeze">
              Freeze
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
                <Button size="sm" variant="danger">
                  Force timeout
                </Button>
              </>
            }
          />
        }
      >
        <div className="g-stack" style={{ gap: 16 }}>
          <div className="g-grid g-grid--kpi">
            <StatTile label="Players left" icon="users" value="1,204" unit="/ 2,000" delta={{ text: '-38', direction: 'down', good: true, context: 'last 10 min' }} spark={[2000, 1900, 1760, 1600, 1480, 1390, 1300, 1242, 1204]} sparkTone="info" />
            <StatTile label="Active tables" icon="layers" value="136" delta={{ text: '-4', direction: 'down', good: true, context: 'broken' }} spark={[223, 210, 190, 176, 160, 150, 141, 140, 136]} />
            <StatTile label="Average stack" icon="activity" value="49,834" unit="62 BB" delta={{ text: '+1.6K', direction: 'up' }} />
            <StatTile label="Hands / min" icon="zap" value="412" delta={{ text: '-6%', direction: 'down', good: false, context: 'vs 1h avg' }} spark={[440, 452, 438, 446, 431, 425, 419, 412]} sparkTone="warning" />
            <StatTile label="Largest pot" icon="trophy" value="1.2M" hint="T12 · hand #1291" />
            <StatTile label="Open alerts" icon="bell" value="3" tone="danger" delta={{ text: '1 critical', direction: 'flat' }} />
          </div>
          <div className="g-admin-grid">
            <Panel
              title="Table map"
              icon="grid"
              description="136 active · windowed grid (only visible rows are rendered)"
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
              <TableMap tables={tables} selectedId={selected} onSelect={setSelected} height={720} />
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
              <ControlCard title="Blind clock" icon="clock" state="Level 14 · 04:31 left · next 500 / 1,000">
                <Button size="sm" icon="minus">
                  1 min
                </Button>
                <Button size="sm" icon="plus">
                  1 min
                </Button>
                <Button size="sm" icon="skip-forward">
                  Next level
                </Button>
                <Button size="sm" variant="ghost">
                  Set level…
                </Button>
              </ControlCard>
              <ControlCard title="Tables" icon="layers" state="136 tables · max imbalance 2 · 7 players in transit">
                <Toggle checked={h4h} onChange={setH4h} label="Hand-for-hand" description="All tables start hands together" />
                <Button size="sm" variant="danger" icon="split">
                  Break table 37
                </Button>
              </ControlCard>
              <ControlCard title="Stack adjustment" icon="sliders" description="Correct a verified chip error" lockedPermission="STACK_ADJUST">
                <Button size="sm">Adjust stack…</Button>
              </ControlCard>
              <ControlCard title="Emergency" icon="critical" tone="danger" description="Freeze stops every timer and action instantly">
                <Button size="sm" variant="danger" icon="freeze">
                  Emergency freeze
                </Button>
                <Button size="sm" variant="ghost" icon="ban">
                  Cancel tournament
                </Button>
              </ControlCard>
            </div>
          </div>
          <div className="g-admin-grid">
            <Panel
              title="Players"
              icon="users"
              flush
              actions={<SearchInput value={q} onChange={setQ} label="Search players" placeholder="Name, JPN id, table…" />}
            >
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
                onRowActivate={noop}
                selectedKey="p5"
                pagination={{ page, pageSize: 12, total: 2000, onPageChange: setPage }}
                density="compact"
              />
            </Panel>
            <Panel title="Audit log" icon="file" description="Every override carries an actor and a reason" actions={<Button size="sm" variant="ghost">View all</Button>}>
              <ActivityFeed entries={AUDIT} label="Recent audit events" />
            </Panel>
          </div>
        </div>
      </AdminShell>
    </section>
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
        <Modal
          inline
          open
          placement="right"
          onClose={noop}
          title="Sofia Lind"
          description="JPN-7A42 · Seated · Table 12, seat 2"
          footer={
            <>
              <Button size="sm" icon="move">
                Move player
              </Button>
              <Button size="sm" icon="pause">
                Suspend
              </Button>
              <Button size="sm" variant="danger" icon="ban">
                Disqualify…
              </Button>
            </>
          }
        >
          <div className="g-stack">
            <div className="g-row">
              <StatusPill tone="positive" label="Seated" />
              <StatusPill tone="positive" icon="wifi" label="Online" />
              <StackDisplay amount={23950} label="Stack" size="md" bigBlind={800} />
            </div>
            <DescriptionList
              items={[
                { label: 'Registered', value: '17:42:10' },
                { label: 'Hands played', value: '212' },
                { label: 'Timeouts', value: '0 consecutive' },
                { label: 'Hands since BB', value: '3' },
                { label: 'Device', value: 'iPhone · Safari' },
                { label: 'Session', value: 'sess_91fa…c02', mono: true },
              ]}
            />
            <Tabs label="Player detail" value="hands" onChange={noop} tabs={[{ id: 'hands', label: 'Hands' }, { id: 'moves', label: 'Moves', count: 2 }, { id: 'audit', label: 'Audit', count: 1 }]} />
            <ActivityFeed entries={AUDIT.slice(4, 6)} />
          </div>
        </Modal>
      </div>
      <H3>Toasts</H3>
      <div className="g-stack" style={{ maxWidth: 420 }}>
        <Toast id={1} tone="success" title="Break started" description="All tables held. Resumes at 21:30." onDismiss={noop} durationMs={0} />
        <Toast id={2} tone="warning" title="7 players in transit" description="Moves complete when their current hands end." onDismiss={noop} durationMs={0} action={{ label: 'View', onClick: noop }} />
        <Toast id={3} tone="danger" title="Action rejected: STALE_STATE_VERSION" description="The table moved on. Your screen has been refreshed." onDismiss={noop} />
        <Toast id={4} tone="gold" title="Final table formed" description="Table 1 · 9 players" onDismiss={noop} durationMs={0} />
      </div>
    </Section>
  );
}

function BroadcastSection() {
  return (
    <Section id="broadcast" eyebrow="Projector" title="Broadcast display" lede="Readable from the back of the room.">
      <div className="g-broadcast">
        <TournamentStatus name="Spring Showdown 2026" status="RUNNING" playersRemaining={184} playersTotal={2000} tables={21} level={14} averageStack={326_087} handForHand />
        <div className="g-broadcast-grid">
          <BlindClock variant="broadcast" current={{ level: 14, smallBlind: 400, bigBlind: 800, ante: 800 }} next={{ level: 15, smallBlind: 500, bigBlind: 1000, ante: 1000 }} levelEndsAt={NOW + 271_000} serverOffsetMs={0} />
          <Leaderboard
            size="broadcast"
            mode="stack"
            rows={[
              { id: '1', rank: 1, name: 'Diego Alvarez', stack: 1_480_000 },
              { id: '2', rank: 2, name: 'Kenji Watanabe', stack: 1_210_500 },
              { id: '3', rank: 3, name: 'Wei Zhang', stack: 998_400 },
              { id: '4', rank: 4, name: 'Ravi Kapoor', stack: 912_000 },
              { id: '5', rank: 5, name: 'Theo Martins', stack: 880_250 },
            ]}
          />
        </div>
        <MilestoneBanner size="broadcast" title="The money bubble has burst" detail="181 players are now guaranteed a prize" icon="award" />
        <div className="g-row" style={{ justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--jpb-text-muted)' }}>
            Prize pool <b style={{ color: 'var(--jpb-text)' }}>{formatMoneyMinor(200_000_000, 'INR')}</b>
          </span>
          <Sparkline data={[2000, 1700, 1300, 950, 640, 420, 300, 230, 184]} tone="info" width={240} height={40} label="Players remaining falling from 2,000 to 184" />
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
