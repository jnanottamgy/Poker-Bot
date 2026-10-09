import type { ReactNode } from 'react';
import { Panel } from '@jpb/ui';
import { FAIRNESS_METHOD } from './engine';
import { CopyButton, HashValue } from './ui';

const RUN_SNIPPET = `# 1. Save the export from "Export verification bundle" as fairness-export.json
# 2. Copy packages/fairness-engine/examples/verify-hand.mjs (or the script in
#    docs/FAIRNESS.md §6 — standard SHA-256 / HMAC-SHA256 only, no dependencies)
# 3. Run with Node.js 18+:
cat > verify-all.mjs <<'JS'
import { readFileSync } from 'fs';
import { verifyHand, publicEntropy } from './verify-hand.mjs';
const b = JSON.parse(readFileSync('fairness-export.json', 'utf8'));
if (b.entropyInputs) console.log('entropy ok:', publicEntropy(b.entropyInputs.clientSeeds, b.entropyInputs.adminEntropy) === b.publicEntropy);
for (const h of b.hands) console.log(h.handId, verifyHand(h, b.serverSeed));
JS
node verify-all.mjs`;

const METHOD_ROWS: Array<[string, string]> = [
  ['Commitment', FAIRNESS_METHOD.commitment],
  ['Public entropy', FAIRNESS_METHOD.publicEntropy],
  ['Deck label', FAIRNESS_METHOD.deckLabel],
  ['Stream', FAIRNESS_METHOD.stream],
  ['Unbiased integers', FAIRNESS_METHOD.uniformInt],
  ['Shuffle', FAIRNESS_METHOD.shuffle],
  ['Canonical deck', FAIRNESS_METHOD.canonicalDeck],
  ['Deck hash', FAIRNESS_METHOD.deckHash],
  ['Dealing order', FAIRNESS_METHOD.dealing],
];

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="acr-fair-step">
      <span className="acr-fair-step__n" aria-hidden="true">
        {n}
      </span>
      <div className="acr-fair-step__body">
        <p className="acr-fair-step__title">{title}</p>
        <div className="acr-fair-step__text">{children}</div>
      </div>
    </li>
  );
}

/** The exact constructions (as stated by the engine embedded in this page). */
export function MethodPanel({ method }: { method: string }) {
  return (
    <Panel title="Randomness method" icon="sliders" description="HMAC-SHA256 counter-mode stream keyed by the server seed, rejection sampling and a Fisher–Yates shuffle. No AI, no hidden inputs." className="acr-fair-method">
      <p className="acr-fair-method__id">
        Server method id: <code>{method}</code> · scheme <code>JPB/v1</code>
      </p>
      <dl className="acr-fair-method__list">
        {METHOD_ROWS.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>
              <code>{v}</code>
            </dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

/** §2.11 step-by-step independent verification (docs/FAIRNESS.md §6). */
export function Instructions({ serverSeedHash, joinCode }: { serverSeedHash: string; joinCode: string | null }) {
  return (
    <Panel title="Verify independently — step by step" icon="file" description="Nobody has to trust this page or the server: any language with SHA-256 and HMAC-SHA256 reproduces every deck byte for byte." className="acr-fair-steps">
      <ol className="acr-fair-steplist">
        <Step n={1} title="Check the commitment you trust">
          <p>Compare this hash with the one shown before registration opened (join page, screenshot, announcement). Everything else is only as strong as this comparison.</p>
          <HashValue value={serverSeedHash} what="Server seed hash" />
        </Step>
        <Step n={2} title="Get the data">
          <p>
            After the tournament ends and the seed is revealed, download the JSON export above. It contains the seed, the commitment, the public entropy with all its inputs and the hand records. Players can fetch their own hands (with their hole cards) from the player API
            {joinCode ? (
              <>
                , and anyone can read <code>/api/public/tournaments/{joinCode}/fairness</code>
              </>
            ) : null}
            .
          </p>
        </Step>
        <Step n={3} title="Check the public entropy">
          <p>Players who kept the client seed their browser sent at registration confirm it appears in the inputs. Recompute: SHA-256 of the sorted client seeds and the admin entropy must equal the public entropy.</p>
        </Step>
        <Step n={4} title="Check the seed">
          <p>SHA-256 of the 32 seed bytes (not the hex text) must equal the commitment from step 1.</p>
        </Step>
        <Step n={5} title="Re-derive each deck">
          <p>
            Shuffle the canonical deck with the HMAC-SHA256 stream labelled <code>{FAIRNESS_METHOD.deckLabel}</code> and compare the SHA-256 of the 104-character deck string with the hand's deck hash.
          </p>
        </Step>
        <Step n={6} title="Check the cards">
          <p>Order the dealt-in seats from the first seat after the button; every published hole card, board card and burn card must sit at its deck position.</p>
        </Step>
        <Step n={7} title="Run the standalone script">
          <div className="acr-fair-snippet">
            <CopyButton text={RUN_SNIPPET} what="Commands" />
            <pre>
              <code>{RUN_SNIPPET}</code>
            </pre>
          </div>
        </Step>
      </ol>
      <p className="acr-fair-dim acr-fair-steps__limits">
        What this proves — and what it does not — is spelled out in docs/FAIRNESS.md §2–3: the deal cannot have been changed after the commitment, but live information leaks or collusion are policed by staff and the audit log, not by cryptography.
      </p>
    </Panel>
  );
}
