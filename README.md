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
  refused; and the signed card survives being drawn, downscaled to 40% and read back off the pixels). Deterministic
  keys, so **CI re-runs it and demands a byte-identical receipt**: `node tools/edge-receipt.mjs --check`.
- `receipts/edge-verify-webrtc.json` — the same three verdicts, live, between two independent browser nodes over a
  real WebRTC DataChannel with no server and no STUN; the network log shows zero requests leaving the machine.
  (Two nodes on one machine; the two-device run is pending a second device.)

Pairing needs no signalling server: one node makes an invite, you send it however you already talk, and paste back
the one reply. The link is fall-os's; the invite check is fall-federate's (both vendored, credited).

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

## The honest claims (each measured, each re-runnable)

- **The seed germinates offline, reproducing the sealed figure.** The 41-byte seed
  `◊ spore.v1 funnel 11 f:579fc3f04c233901` grows a 9,464-byte organ that scores **0.820498** held-out AUC —
  the exact number fall-spore sealed (commit `4c3ab7b`). Re-run it at https://sjgant80-hub.github.io/fall-spore/
  or by germinating the seed in `grow from a card`.
- **The visible band survives a re-encode.** In the mutation-gated kernel, the seed reads back after the
  card is downscaled to **30% of its size and crushed to 3 grey levels** (`survives()` in `spore-card.mjs`).
  The browser `grow from a card` reads it back after a real JPEG re-encode.
- **A corrupt read is refused, not faked.** The CRC-16 means a damaged or tampered card fails to decode
  rather than germinating the wrong thing.

The card also carries the exact seed losslessly in a `spoR` PNG chunk (`spore-card-chunk.mjs`, Node) for a
file that travels intact; a platform that re-encodes the image strips it, which is what the visible band is for.

## Re-run the gate

```
npm test          # the kernel's behaviour tests
npm run witness   # the mutation gate over spore-card.mjs — exit 0 only if clean
```

## Provenance

The seed and the germination engine are [fall-spore](https://sjgant80-hub.github.io/fall-spore/) (vendored,
MIT). The PNG chunk primitives are [fallkard-forge](https://sjgant80-hub.github.io/fallkard-forge/) (vendored,
MIT). The bundled dataset is the UCI *Online Shoppers Purchasing Intention* sessions. Powered by the Konomi
architecture, created by Thomas Frumkin.
