# NO AI IN GAME LOGIC

Johnny's Poker Bot is a **digital tournament director**, not a chatbot playing
poker. Johnny doesn't think, guess, or decide who deserves to win. Johnny
executes rules.

The following must **never** be implemented with AI, machine learning, neural
networks, large language models (ChatGPT, OpenAI, Claude, Gemini or any other),
or AI-generated randomness:

- deck generation
- randomness of any kind
- hand evaluation
- betting and action validation
- winner selection and pot distribution
- table balancing and table breaking
- seating and player movement
- blind scheduling and the blind clock
- elimination
- ranking and finishing positions
- prize calculation
- commentary and announcements (fixed templates only)
- simulation/test bots (deterministic strategies only)

Every one of these is a mathematical or programmatic algorithm:

| Concern | Mechanism |
| --- | --- |
| Randomness | Platform CSPRNG (`node:crypto`) for seeds; HMAC-SHA256 counter-mode stream for reproducible, auditable shuffles |
| Shuffle | Durstenfeld Fisher–Yates with rejection sampling (unbiased) |
| Fairness | SHA-256 commit–reveal of the server seed, per-hand deck derivation, independent verifier |
| Hand evaluation | Exhaustive, exact 7-card evaluator, cross-checked against brute force in tests |
| Betting | Explicit finite-state machine with TDA-aligned rules |
| Seating & balancing | Documented deterministic scoring formulas, deterministic tie-breaks |
| Ranking | Elimination order with a documented tie rule |
| Prizes | Fixed table configured before start |
| Bots | Seeded deterministic strategies (`ALWAYS_FOLD`, `RANDOM_LEGAL_ACTION`, `CALL_HEAVY`, `RAISE_HEAVY`, `ALL_IN_RANDOMLY`) |

Enforcement:

- ESLint forbids `Math.random()` anywhere in the codebase.
- No AI/ML SDK is a dependency of any package (checked in CI by
  `tests/integration/no-ai-dependencies.test.ts`).
- Every decision that affects play is reproducible from the command log, the
  revealed seed and the configuration.
