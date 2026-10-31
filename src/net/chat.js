// Chat in online rooms. Every page posts its own last few messages in its room presence and every
// other page in the room reads them from there, so nothing goes through the host. A message stays
// posted for 20 seconds, long enough for everyone in the room to have seen it, and is then taken
// down again so the presence stays small.
const MAX_LEN = 80;
const KEEP = 3;
const TTL = 20000;
const GAP = 700;
const BAD = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u206f\\ufeff]', 'g');

export function cleanChat(s) {
  return String(s == null ? '' : s)
    .replace(BAD, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_LEN);
}

export class Chat {
  constructor() {
    this.ch = null;
    this.who = null;
    // message numbers keep rising on this page even across a change of host (a page posts at most one
    // message every 0.7 s, the clock moves 7 steps in that time)
    this.n = Math.floor(Date.now() / 100) % 1e9;
    this.items = []; // [n, text, postedAt]
    this.seen = new Map(); // peer -> highest message number shown
    this.sink = null;
    this.buffer = [];
    this.lastPost = 0;
    this.timer = null;
  }

  // the room channel this page posts in, and who(peer, presence) -> { name, color } for the names
  bind(ch, who) {
    this.ch = ch;
    this.who = who;
    if (this.items.length) this.publish();
  }

  attach(sink) {
    this.sink = sink;
    const b = this.buffer;
    this.buffer = [];
    for (const m of b) sink(m);
  }

  detach(sink) {
    if (!sink || this.sink === sink) this.sink = null;
  }

  // returns null when sent, or why not ('empty', 'fast', 'off')
  post(text) {
    const t = cleanChat(text);
    if (!t) return 'empty';
    if (!this.ch) return 'off';
    const now = Date.now();
    if (now - this.lastPost < GAP) return 'fast';
    this.lastPost = now;
    this.n++;
    this.items.push([this.n, t, now]);
    while (this.items.length > KEEP) this.items.shift();
    this.publish();
    this.arm();
    const me = this.ch.me ? this.ch.me() : null;
    const w = (this.who && this.who(me, null)) || {};
    this.emit({ name: w.name || '你', color: w.color || null, text: t, mine: true });
    return null;
  }

  // a line from the game itself, shown only on this page
  note(text) {
    this.emit({ text, note: true });
  }

  publish() {
    if (!this.ch) return;
    const list = this.items.map(([n, t]) => [n, t]);
    this.ch.presence({ chat: list.length ? list : null }).catch(() => {});
  }

  arm() {
    clearTimeout(this.timer);
    if (!this.items.length) return;
    const due = this.items[0][2] + TTL - Date.now();
    this.timer = setTimeout(() => this.prune(), Math.max(50, due));
  }

  prune() {
    const now = Date.now();
    const before = this.items.length;
    this.items = this.items.filter((x) => now - x[2] < TTL);
    if (this.items.length !== before) this.publish();
    this.arm();
  }

  // new messages in the room's presences
  receive(peers) {
    if (!Array.isArray(peers)) return;
    for (const p of peers) {
      if (!p || p.sameTab) continue;
      const pr = p.presence;
      const list = pr && Array.isArray(pr.chat) ? pr.chat : null;
      if (!list) continue;
      const last = this.seen.has(p.peer) ? this.seen.get(p.peer) : -1;
      let max = last;
      for (const it of list.slice(-KEEP)) {
        if (!Array.isArray(it) || !Number.isInteger(it[0]) || it[0] <= last) continue;
        max = Math.max(max, it[0]);
        const text = cleanChat(it[1]);
        if (!text) continue;
        const w = (this.who && this.who(p.peer, pr)) || {};
        this.emit({ name: w.name || '玩家', color: w.color || null, text, mine: false });
      }
      this.seen.set(p.peer, max);
    }
  }

  emit(m) {
    if (this.sink) this.sink(m);
    else {
      this.buffer.push(m);
      while (this.buffer.length > 20) this.buffer.shift();
    }
  }

  close() {
    clearTimeout(this.timer);
    this.sink = null;
    this.ch = null;
  }
}
