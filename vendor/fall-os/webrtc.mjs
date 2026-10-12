// webrtc.mjs — THE SAME CHANNEL, WITH A NETWORK BEHIND IT.
//
// Phase 1. Everything above this file — discovery, the handshake, the gap-match, the pub — is
// unchanged and untouched. `r7.mjs` takes a channel with `send` and `on`; loopback was one
// implementation and this is another. That was the whole point of injecting the transport, and there
// is a test that runs the identical exchange over both and demands byte-identical results.
//
// ⚑ NO SIGNALLING SERVER. WebRTC normally needs a third party to introduce two peers — and a server
// that every meeting must pass through is precisely the landlord the pub exists to do without. So the
// introduction is done BY HAND: you create an invite, send it to Gerald however you already talk to
// him, he sends one line back, and the connection is direct from then on. It is clunky for a hundred
// peers. For two people who know each other it costs one paste and removes the only central thing in
// the design.
//
// ⚑ WHAT THIS DOES DEPEND ON, said plainly. A STUN server to discover the public address of a machine
// behind a router. It sees an IP and nothing else — no manifest, no organ, no traffic; the media path
// does not go through it. It is still an external dependency and it is named here rather than buried:
// set `stun: []` to run with none at all, which works on the same LAN and usually fails across the
// internet. If Gerald and you are both behind strict NATs, a direct path may not exist at all and the
// honest answer is that this connection will fail rather than silently routing through someone else.

const DEFAULT_STUN = ['stun:stun.l.google.com:19302'];

const enc = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '');
const dec = (s) => JSON.parse(atob(String(s).trim()));

/**
 * ⚑ THE ALLOWLIST. A private mesh of two is not a small public mesh — it is a different thing, and
 * the difference has to be enforced rather than assumed. Only ids on this list get past discovery;
 * anyone else is dropped before their manifest is ever recorded, let alone cross-run.
 *
 * This is BELT AND BRACES over the handshake, not a replacement for it: the handshake proves a peer
 * is honest, and the allowlist decides whether you wanted to talk to them at all. A stranger who
 * would pass the handshake perfectly still does not get in.
 */
export function allowOnly(channel, ids = []) {
  const allowed = new Set(ids.filter(Boolean));
  return {
    kind: channel.kind + '+allowlist',
    allowed: [...allowed],
    send: (msg) => channel.send(msg),
    on: (fn) => channel.on((msg) => {
      const id = msg && msg.face && msg.face.id;
      // No id, or an id nobody invited: dropped here, before r7 ever sees it.
      if (!id || !allowed.has(id)) return;
      fn(msg);
    }),
  };
}

/**
 * One side of a direct link. `role` is only about who speaks first in the introduction; once the
 * channel is open the two sides are identical, which is what peer-not-up means at the transport layer.
 */
export function makeLink({ stun = DEFAULT_STUN, label = 'didy' } = {}) {
  if (typeof RTCPeerConnection === 'undefined') {
    return { ok: false, why: 'this runtime has no WebRTC — the browser window has it, node does not' };
  }
  const pc = new RTCPeerConnection({ iceServers: stun.length ? [{ urls: stun }] : [] });
  const listeners = new Set();
  let dc = null;

  const wire = (channel) => {
    dc = channel;
    dc.onmessage = (e) => {
      let msg; try { msg = JSON.parse(e.data); } catch { return; }   // junk on the wire is dropped, not thrown on
      for (const fn of [...listeners]) fn(msg);
    };
  };
  pc.ondatachannel = (e) => wire(e.channel);

  // Gather ICE candidates into the offer/answer rather than trickling them, so the whole
  // introduction is ONE blob a person can copy. Slower to produce, far easier to hand to someone.
  const settled = () => new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const check = () => { if (pc.iceGatheringState === 'complete') { pc.removeEventListener('icegatheringstatechange', check); resolve(); } };
    pc.addEventListener('icegatheringstatechange', check);
    setTimeout(resolve, 4000);      // a router that never says "complete" must not hang the invite
  });

  const link = {
    kind: 'webrtc',
    pc,
    get state() { return pc.connectionState; },
    get open() { return !!dc && dc.readyState === 'open'; },

    /** Side A: make an invite to send to Gerald. */
    async invite() {
      wire(pc.createDataChannel(label, { ordered: true }));
      await pc.setLocalDescription(await pc.createOffer());
      await settled();
      return enc(pc.localDescription);
    },

    /** Side B: take Gerald's invite, return the one line to send back. */
    async accept(inviteBlob) {
      await pc.setRemoteDescription(dec(inviteBlob));
      await pc.setLocalDescription(await pc.createAnswer());
      await settled();
      return enc(pc.localDescription);
    },

    /** Side A: paste in what came back, and the link is live. */
    async finish(answerBlob) {
      await pc.setRemoteDescription(dec(answerBlob));
      return true;
    },

    /** Resolves when the data channel is genuinely usable, or rejects with a reason. */
    ready(ms = 20000) {
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('the link did not open within ' + (ms / 1000) + 's — a direct path may not exist between these two machines')), ms);
        const tick = () => {
          if (link.open) { clearTimeout(t); resolve(true); }
          else if (pc.connectionState === 'failed') { clearTimeout(t); reject(new Error('the connection failed — no direct path was found')); }
          else setTimeout(tick, 200);
        };
        tick();
      });
    },

    // ── the channel shape r7 expects, and nothing more ──
    send(msg) { if (link.open) dc.send(JSON.stringify(msg)); },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    close() { try { dc && dc.close(); } catch {} try { pc.close(); } catch {} },
  };
  link.ok = true;
  return link;
}

export default { makeLink, allowOnly };
