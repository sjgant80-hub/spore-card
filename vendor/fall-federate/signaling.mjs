// signaling.mjs — the manual-signaling envelope for sovereign P2P federation (witness-gated).
//
// No signaling server: two peers trade an OFFER blob and an ANSWER blob BY HAND over a channel they already
// trust (Signal, in person). STUN supplies the reflexive public address so the connection crosses networks;
// no TURN relay, no backend. This kernel is the pure part — validate and read the invite envelope — so a
// malformed or oversized blob is refused cleanly rather than fed to RTCPeerConnection. base64 wrapping is a
// thin edge in the page. Pattern proven in the estate's fallroom / sovereign-p2p-webrtc.
export const INVITE_KIND = 'fed-invite-v1';
const MAX_SDP = 20000;   // a full SDP with gathered candidates is a few KB; cap a hostile blob

const isStr = (v) => typeof v === 'string';
// the identity travels as an Ed25519 public key in base64url JWK 'x' form (~43 chars); accept a base64url
// token in a sane length band, so garbage and oversized ids are refused.
function isId(v) {
  return isStr(v) && v.length >= 20 && v.length <= 100 && /^[A-Za-z0-9_-]+$/.test(v);
}

// makeInvite(role, id, sdp) — build a validated invite. role is 'offer' (the host) or 'answer' (the guest).
export function makeInvite(role, id, sdp) {
  if (role !== 'offer' && role !== 'answer') return { ok: false, why: 'role must be offer or answer' };
  if (!isId(id)) return { ok: false, why: 'id must be a public-key token' };
  if (!isStr(sdp) || sdp.length < 20) return { ok: false, why: 'sdp missing or too short' };
  if (sdp.length > MAX_SDP) return { ok: false, why: 'sdp exceeds the size cap' };
  return { ok: true, invite: { v: 1, kind: INVITE_KIND, role, id, sdp } };
}

// readInvite(obj) — validate a received invite before it is trusted or handed to WebRTC.
export function readInvite(obj) {
  if (!obj || typeof obj !== 'object') return { ok: false, why: 'not an invite object' };
  if (obj.kind !== INVITE_KIND) return { ok: false, why: 'unrecognised invite kind' };
  const m = makeInvite(obj.role, obj.id, obj.sdp);   // re-validate every field on the way in
  if (!m.ok) return m;
  return { ok: true, role: obj.role, id: obj.id, sdp: obj.sdp };
}

// theOther(role) — the reply role a received invite expects (an offer is answered, an answer is terminal).
export function theOther(role) {
  if (role === 'offer') return 'answer';
  return '';
}

export default { INVITE_KIND, makeInvite, readInvite, theOther };
