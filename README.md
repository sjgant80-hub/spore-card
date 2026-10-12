# Spore Card

**Live:** https://sjgant80-hub.github.io/spore-card/ · **The mesh:** https://sjgant80-hub.github.io/spore-card/mesh.html

## The mesh — a node accepts a card only if it reproduces it

A **signed** card (v2) carries the seed, the score it claims, a tag for the data the score was measured on, and the
forger's Ed25519 key — all under one signature. A receiving machine does not take its word. It checks, in order:

1. **seal** — does the signature cover these exact bytes? (one changed byte → refused)
2. **data** — does this machine hold the same data? (otherwise it cannot re-run the claim → refused)
3. **re-run** — it grows the seed itself; the held-out score must come out identical (a perfectly signed card that
   claims a score it did not earn → refused)

**A signature proves who. Only a re-run proves what.** Proven two ways:

- `receipts/edge-verify.json` — the done-test (genuine accepted; tampered, false-claim, other-data and unsigned
  refused; a self-signed grow seed and a fixed seed whose settings point past their grids both refused before any
  re-run; and the signed card survives being drawn, downscaled to 40% and read back off the pixels). Deterministic
  keys, so **CI re-runs it and demands a byte-identical receipt**: `node tools/edge-receipt.mjs --check`.
- `receipts/edge-verify-webrtc.json` — the same three verdicts, live, between two independent browser nodes over a
  real WebRTC DataChannel with no server and no STUN; the network log shows zero requests leaving the machine.
  (Two nodes on one machine; the two-device run is pending a second device.)

Pairing needs no signalling server: one node makes an invite, you send it however you already talk, and paste back
the one reply. The link is fall-os's; the invite check is fall-federate's (both vendored, credited).

## Hand off the heavy work — a signed job, a sealed answer, a re-run

A small device (a phone) can ask a bigger one (a laptop) to **grow** a seed for it, without trusting the laptop:

1. **The job is signed and addressed.** The requester signs a canonical job: the grow spore, a tag for the data,
   an evals cap (≤ 500), a nonce, an expiry (≤ 7 days), and the **one worker key it is meant for**.
2. **The worker refuses before it spends anything.** In order: shape → seal → time → audience (a job addressed to
   another node is refused) → is the requester allowed → does it hold the data → is the job within its limits →
   and only then does it **claim the job atomically** (a replay is refused; a job refused for any other reason
   leaves nothing in the replay memory). Only then does it grow. Running jobs is **opt-in**: a job that arrives
   over the link runs only if you have ticked the box (then it runs automatically) or you click "Run it now" on
   that one job; a saved job file runs only when you drop or choose it — and a dropped file stands in for the
   requester being allowed, so it still has to be signed and addressed to this node.
3. **The answer is a v3 card.** It carries the champion it grew as a **fixed** seed, the score, and a 32-byte
   **citation of the exact job** it answers, all under the worker's signature.
4. **The requester re-runs it.** It checks the seal, that the answer cites *its* job, that it is signed by the
   worker the job was sent to, that the seed is a fixed genome (a verifier never grows), then re-runs it. The
   score must reproduce.

Proven: `receipts/job-roundtrip.json` — round-trip accepted; tampered job, replay, expired, not-allowed,
addressed-elsewhere, an answer to a different job, and a worker that lies about its score all refused; and the
sealed answer still accepted after being drawn and read back off a picture. CI regenerates it byte-for-byte:
`node tools/job-receipt.mjs --check`.

Live: `receipts/job-handoff-webrtc.json` — two independent browser nodes over a real WebRTC DataChannel, no STUN,
no server. The "phone" sent a signed job; the "laptop" grew it (104 evaluations) and sent back a sealed answer
card; the phone re-ran it and got 0.820498 — accepted. Then, live on the worker: the same job again (refused:
replay), the job with one field changed (refused: seal), a validly signed job addressed to another key (refused:
audience). The network log shows zero requests leaving the machine.

**An optional model may only propose.** A local model (Ollama) or your own key (`--byok`, key from the
environment only, never written) may suggest extra genomes. Each is scored on the grow's own inner split and kept
only if it beats the grown champion there; the requester still re-runs the answer. The job passes with no model at
all — the seed is the instruction layer, not the model. `receipts/byok-roundtrip.json` records what the model
suggested and CI re-runs every decision from that record (`node tools/byok-receipt.mjs --check`); a model's
sampling is the one thing CI cannot re-run, so it is an input, not a result.

What a re-run does **not** prove, plainly:

- It proves the worker's **claim**, not that the worker found the **best** genome — a lazy worker that returns a
  weak champion honestly is not caught. The job states an evals budget; the receipt shows how many were spent.
- "Earned" means the champion beats the stem on a **confirmation split** drawn from the training months. That
  reduces selection bias; it does not remove it. Only the held-out months are a real measurement.
- Two pages served from the **same origin** share browser storage; the identity key is non-extractable, but a
  hostile page on that origin could still use it. Run the mesh from its own origin.
- Both nodes ran on **one machine** (two origins, two identities). The two-device run waits on a second device.

A picture that **is** a seed. Save the card, drop it into the grower, and a working model grows on your own
machine — offline, owned by you, reproducing a held-out accuracy you can re-run. The post, the proof and the
product are one image: share the card, and anyone who keeps it can grow the thing it carries.

## What it does

- **Grow a card** — render a verified 41-byte seed as a PNG card and download it. The seed rides in the
  card's pixels as a redundant module band (three copies, a self-describing length header, a CRC-16 that
  refuses a corrupt read), so a downscaled screenshot still reads back.
- **Grow from a card** — drop a saved card. The page reads the seed from the picture and **germinates** it
  locally on the bundled sessions, reproducing a **held-out AUC of 0.820498** on 4,725 sessions it never
  grew on, then hands you your own model file and a receipt you can re-run.

## Card stages — a card that grows, and a history anyone can re-run

A card can now carry **stages**. Stage 0 is the ungrown starting model. Stage 1 is the champion of a grow that starts
from stage 0, on the holder's own machine, with a seed number **keyed to the grower's key** and to the exact stage it
grew from. Each stage is a signed link; the whole chain rides on the card, and whoever holds the card re-checks it:

- **structure, instantly** — every link signed by the key it names, each one chained to the last, the first one
  chained to the rules it names, each seed the kind this reader re-runs, each seed number one its key may grow;
- **then the re-runs, per stage** — the stage's held-out score reproduces exactly (it is *measured*, it never
  decides); on a fresh check split it beats the starting model and **every** stage it grew from; and re-grown here
  for that key from the stage before, the grow lands on exactly the same model.

So a stage cannot be claimed, copied or bought — only grown. Proven by `receipts/stage-unlock.json` (CI regenerates
it byte for byte: `node tools/stage-receipt.mjs --check`): a root and a grown stage 1 pass on a third machine; and
**laundered** (another key re-signs the grown model under its own seed number, with its true score) is refused at the
re-grow; a stolen seed number at the key; a flipped byte at the signature; a spliced chain at the order; a false score
at the re-run; an ungrown "stage" at the climb; a wrong band, two histories, ten links — all refused; unknown rules,
no data or no time give PENDING, never a false refusal. `stages.mjs` (the decisions) is mutation-gated clean with
nothing baselined; the engine it re-runs is pinned, so a sealed rules id never changes meaning.

**Live: [mesh.html → 5 · Grow your card](https://sjgant80-hub.github.io/spore-card/mesh.html#stagesPanel).** Get a
starter, grow the next stage (in a background Worker, a few seconds a try), save the card, your model and the check, or
send the card to the connected machine. Run live (`receipts/stage-webrtc.json`, two browser identities, no server, no
STUN): A grew stage 1 and sent it; B re-checked every stage from scratch (PASS), grew stage 2 under its own key and
sent it back; A re-checked the whole history (PASS, stages 0–2). Stage 2's held-out score *fell* (0.821785 → 0.813054)
while it climbed on its check split — shown, never used to decide. One bit edited in the history: refused at the
signature, instantly.

What it does not prove: where a stage was grown (only that it was grown for that key, reproducibly); that a stage is
the best model, or useful beyond this one public task; held-out can fall while stages rise (both are shown). Not yet
built: breeding two cards, and stages on forge (HTML-build) cards.

## The honest claims (each measured, each re-runnable)

- **The seed germinates offline, reproducing the sealed figure.** The 41-byte seed
  `◊ spore.v1 funnel 11 f:579fc3f04c233901` grows a 9,464-byte organ that scores **0.820498** held-out AUC —
  the exact number fall-spore sealed (commit `4c3ab7b`). Re-run it at https://sjgant80-hub.github.io/fall-spore/
  or by germinating the seed in `grow from a card`.
- **The visible band survives a re-encode.** A deterministic value test (`survives()` in `spore-card-image.mjs`,
  checked by `spore-card-image.test.mjs`) reads the seed back after the card is downscaled to **30% of its size and
  crushed to 3 grey levels**. The bit codec it decodes with (`spore-card.mjs`) is mutation-gated; the raster and
  degrade measurement is value-tested, not mutation-gated (the reason is in `witness-all.mjs`). The browser
  `grow from a card` reads it back after a real JPEG re-encode.
- **A corrupt read is refused, not faked.** The CRC-16 means a damaged or tampered card fails to decode
  rather than germinating the wrong thing.

The card also carries the exact seed losslessly in a `spoR` PNG chunk (`spore-card-chunk.mjs`, Node) for a
file that travels intact; a platform that re-encodes the image strips it, which is what the visible band is for.

## Re-run the gate

```
npm test          # every behaviour test
npm run witness   # the mutation gate over the six kernels (card codec, envelope, edge verdict, job, proposer, the grow's keep rule)
                  # — exit 0 only if every one is clean
node tools/edge-receipt.mjs --check    # re-run the three receipts; each must come out byte-identical
node tools/job-receipt.mjs --check
node tools/byok-receipt.mjs --check
```

## Provenance

The seed and the germination engine are [fall-spore](https://sjgant80-hub.github.io/fall-spore/) (vendored,
MIT). The PNG chunk primitives are [fallkard-forge](https://sjgant80-hub.github.io/fallkard-forge/) (vendored,
MIT). The bundled dataset is the UCI *Online Shoppers Purchasing Intention* sessions. Powered by the Konomi
architecture, created by Thomas Frumkin.
