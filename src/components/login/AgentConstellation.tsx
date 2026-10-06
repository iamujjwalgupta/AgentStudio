"use client";

import { useEffect, useRef } from "react";

/**
 * The sign-in page's backdrop: Agent Studio at the centre, agents orbiting it,
 * the systems they reach on an outer ring. Work flows out as light along the
 * links; a link into a system that changes things stops at an approval gate,
 * waits (amber), is approved (teal) and carries on. Drawn on a canvas, eased
 * toward the pointer for depth. Still frame only when reduced motion is asked
 * for; paused while the tab is hidden.
 */

type Kind = "hub" | "agent" | "tool";
type Node = {
  kind: Kind;
  label: string;
  base: number; // angle on its ring
  gated?: boolean;
  flash: number; // 0..1, decays
  flashColor: string;
  // computed each frame
  x: number;
  y: number;
  z: number; // -1 (back) .. 1 (front)
  s: number; // scale from depth
};
type Packet = {
  from: Node;
  to: Node;
  p: number;
  speed: number;
  leg: "out" | "tool";
  state: "move" | "held" | "ok";
  hold: number;
};

const AGENTS = ["Invoice matcher", "Spend watcher", "Contract reviewer", "Close checklist", "Vendor onboarding", "Audit sampler"];
const TOOLS: { label: string; gated: boolean }[] = [
  { label: "PostgreSQL", gated: false },
  { label: "Slack", gated: true },
  { label: "Amazon S3", gated: true },
  { label: "Jira", gated: false },
  { label: "GitHub", gated: false },
  { label: "Email", gated: true },
  { label: "Teams", gated: true },
  { label: "Web search", gated: false },
];

const C = {
  link: "124,199,239",
  packet: "124,243,255",
  amber: "255,181,71",
  teal: "63,208,201",
  agent: "102,199,244",
  tool: "169,184,255",
};

export default function AgentConstellation({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const mk = (kind: Kind, label: string, base: number, gated?: boolean): Node => ({
      kind, label, base, gated, flash: 0, flashColor: C.teal, x: 0, y: 0, z: 0, s: 1,
    });
    const hub = mk("hub", "Agent Studio", 0);
    const agents = AGENTS.map((l, i) => mk("agent", l, (i / AGENTS.length) * Math.PI * 2 + 0.3));
    const tools = TOOLS.map((t, i) => mk("tool", t.label, (i / TOOLS.length) * Math.PI * 2 + Math.PI / TOOLS.length, t.gated));
    const links = agents.map((_, i) => {
      const a = Math.round((i * TOOLS.length) / AGENTS.length) % TOOLS.length;
      return [tools[a], tools[(a + 3) % TOOLS.length]];
    });
    const stars = Array.from({ length: 150 }, () => ({
      x: Math.random(),
      y: Math.random(),
      z: Math.random(),
      ph: Math.random() * Math.PI * 2,
    }));
    let packets: Packet[] = [];

    let w = 0, h = 0, raf = 0, last = performance.now(), spawn = 0;
    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = r.width;
      h = r.height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (reduce) frame(performance.now());
    };

    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      pointer.tx = ((e.clientX - r.left) / Math.max(r.width, 1) - 0.5) * 2;
      pointer.ty = ((e.clientY - r.top) / Math.max(r.height, 1) - 0.5) * 2;
    };

    /** Lay the rings out for this moment: two tilted ellipses, turning opposite ways. */
    const place = (t: number) => {
      // Centred in the lower part of the hero, below the headline and above the
      // example-run strip; sized by height too, so short screens keep the gap.
      const cx = w * 0.5, cy = h * 0.63;
      const unit = Math.min(w * 0.92, h * 0.95);
      const tilt = 0.4;
      const r1 = unit * 0.19, r2 = unit * 0.35;
      const put = (n: Node, R: number, a: number, depth: number) => {
        n.z = Math.sin(a);
        n.s = 0.78 + 0.32 * ((n.z + 1) / 2);
        const par = depth * (0.6 + 0.4 * ((n.z + 1) / 2));
        n.x = cx + Math.cos(a) * R + pointer.x * 22 * par;
        n.y = cy + Math.sin(a) * R * tilt + pointer.y * 14 * par;
      };
      hub.x = cx + pointer.x * 6;
      hub.y = cy + pointer.y * 4;
      hub.z = 0.2;
      hub.s = 1;
      agents.forEach((n) => put(n, r1, n.base + t * 0.06, 0.6));
      tools.forEach((n) => put(n, r2, n.base - t * 0.035, 1));
      return { cx, cy, r1, r2, tilt };
    };

    const curve = (a: Node, b: Node, bend: number, p: number) => {
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const dx = b.x - a.x, dy = b.y - a.y;
      const qx = mx - dy * bend, qy = my + dx * bend;
      const u = 1 - p;
      return { x: u * u * a.x + 2 * u * p * qx + p * p * b.x, y: u * u * a.y + 2 * u * p * qy + p * p * b.y, qx, qy };
    };
    const bendOf = (pk: { leg: string }) => (pk.leg === "tool" ? 0.16 : 0);

    const newPacket = () => {
      const i = Math.floor(Math.random() * agents.length);
      packets.push({ from: hub, to: agents[i], p: 0, speed: 0.5 + Math.random() * 0.25, leg: "out", state: "move", hold: 0 });
    };

    const step = (dt: number) => {
      spawn -= dt;
      if (spawn <= 0 && packets.length < 28) {
        newPacket();
        spawn = 0.22 + Math.random() * 0.3;
      }
      const next: Packet[] = [];
      for (const pk of packets) {
        if (pk.state === "held") {
          pk.hold -= dt;
          if (pk.hold <= 0) pk.state = "ok";
          next.push(pk);
          continue;
        }
        pk.p += pk.speed * dt;
        if (pk.leg === "tool" && pk.to.gated && pk.state === "move" && pk.p >= 0.55) {
          pk.p = 0.55;
          pk.state = "held";
          pk.hold = 0.9 + Math.random() * 0.7;
        }
        if (pk.p >= 1) {
          pk.to.flash = 1;
          pk.to.flashColor = pk.state === "ok" ? C.teal : C.packet;
          if (pk.leg === "out") {
            const ts = links[agents.indexOf(pk.to)];
            const tool = ts[Math.floor(Math.random() * ts.length)];
            next.push({ from: pk.to, to: tool, p: 0, speed: 0.38 + Math.random() * 0.2, leg: "tool", state: "move", hold: 0 });
          }
          continue;
        }
        next.push(pk);
      }
      packets = next;
      for (const n of [hub, ...agents, ...tools]) n.flash = Math.max(0, n.flash - dt * 1.6);
    };

    const chip = (x: number, y: number, text: string, alpha: number, accent: string, size: number) => {
      ctx.font = `500 ${size}px "IBM Plex Sans", system-ui, sans-serif`;
      const tw = ctx.measureText(text).width;
      const pw = tw + 16, ph = size + 10;
      const rx = x - pw / 2, ry = y - ph / 2;
      ctx.beginPath();
      ctx.roundRect(rx, ry, pw, ph, ph / 2);
      ctx.fillStyle = `rgba(8,22,58,${0.72 * alpha})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${accent},${0.38 * alpha})`;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = `rgba(226,236,255,${0.92 * alpha})`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, x, y + 0.5);
    };

    const glow = (x: number, y: number, r: number, rgb: string, a: number) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${rgb},${a})`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    };

    const frame = (now: number) => {
      const t = now / 1000;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      pointer.x += (pointer.tx - pointer.x) * 0.05;
      pointer.y += (pointer.ty - pointer.y) * 0.05;
      if (!reduce) step(dt);
      const { cx, cy, r1, r2, tilt } = place(reduce ? 0 : t);

      ctx.clearRect(0, 0, w, h);

      // stars
      for (const s of stars) {
        const tw = reduce ? 0.6 : 0.45 + 0.55 * Math.sin(t * (0.6 + s.z) + s.ph);
        const x = s.x * w - pointer.x * 10 * s.z;
        const y = s.y * h - pointer.y * 8 * s.z;
        ctx.fillStyle = `rgba(190,215,255,${0.08 + 0.32 * s.z * tw})`;
        ctx.fillRect(x, y, 1 + s.z, 1 + s.z);
      }

      // orbits
      ctx.save();
      ctx.setLineDash([2, 7]);
      ctx.lineDashOffset = -t * 8;
      ctx.strokeStyle = `rgba(${C.link},0.16)`;
      ctx.lineWidth = 1;
      for (const R of [r1, r2]) {
        ctx.beginPath();
        ctx.ellipse(cx + pointer.x * 10, cy + pointer.y * 7, R, R * tilt, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();

      // links
      ctx.lineWidth = 1;
      for (const a of agents) {
        ctx.strokeStyle = `rgba(${C.link},${0.1 + 0.1 * ((a.z + 1) / 2)})`;
        ctx.beginPath();
        ctx.moveTo(hub.x, hub.y);
        ctx.lineTo(a.x, a.y);
        ctx.stroke();
      }
      agents.forEach((a, i) => {
        for (const tl of links[i]) {
          const { qx, qy } = curve(a, tl, 0.16, 0);
          ctx.strokeStyle = `rgba(${tl.gated ? "255,200,120" : C.link},${0.07 + 0.08 * ((tl.z + 1) / 2)})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.quadraticCurveTo(qx, qy, tl.x, tl.y);
          ctx.stroke();
        }
      });

      // hub
      glow(hub.x, hub.y, 120, "0,145,218", 0.28);
      if (!reduce) {
        for (let k = 0; k < 3; k++) {
          const ph = ((t * 0.45 + k / 3) % 1);
          ctx.strokeStyle = `rgba(${C.agent},${0.35 * (1 - ph)})`;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.ellipse(hub.x, hub.y, 20 + ph * 70, (20 + ph * 70) * 0.62, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = `rgba(${C.packet},0.55)`;
      ctx.beginPath();
      ctx.arc(hub.x, hub.y, 30, t * 0.9, t * 0.9 + 1.4);
      ctx.stroke();
      ctx.strokeStyle = `rgba(${C.tool},0.45)`;
      ctx.beginPath();
      ctx.arc(hub.x, hub.y, 38, -t * 0.6, -t * 0.6 + 2.1);
      ctx.stroke();
      const core = ctx.createLinearGradient(hub.x - 20, hub.y - 20, hub.x + 20, hub.y + 20);
      core.addColorStop(0, "#0091da");
      core.addColorStop(1, "#1e49e2");
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.roundRect(hub.x - 19, hub.y - 19, 38, 38, 11);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.85)";
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.beginPath(); // the brand mark: a small spark
      ctx.moveTo(hub.x, hub.y - 9);
      ctx.lineTo(hub.x + 3, hub.y - 3);
      ctx.lineTo(hub.x + 9, hub.y);
      ctx.lineTo(hub.x + 3, hub.y + 3);
      ctx.lineTo(hub.x, hub.y + 9);
      ctx.lineTo(hub.x - 3, hub.y + 3);
      ctx.lineTo(hub.x - 9, hub.y);
      ctx.lineTo(hub.x - 3, hub.y - 3);
      ctx.closePath();
      ctx.stroke();

      // packets, behind-to-front with their nodes
      ctx.globalCompositeOperation = "lighter";
      for (const pk of packets) {
        const bend = bendOf(pk);
        const head = curve(pk.from, pk.to, bend, pk.p);
        const tail = curve(pk.from, pk.to, bend, Math.max(0, pk.p - 0.09));
        const rgb = pk.state === "held" ? C.amber : pk.state === "ok" ? C.teal : C.packet;
        const g = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y);
        g.addColorStop(0, `rgba(${rgb},0)`);
        g.addColorStop(1, `rgba(${rgb},0.85)`);
        ctx.strokeStyle = g;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(tail.x, tail.y);
        ctx.lineTo(head.x, head.y);
        ctx.stroke();
        glow(head.x, head.y, pk.state === "held" ? 16 : 9, rgb, 0.9);
        if (pk.state === "held") {
          const ph = (t * 1.6) % 1;
          ctx.strokeStyle = `rgba(${C.amber},${0.8 * (1 - ph)})`;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(head.x, head.y, 6 + ph * 14, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.globalCompositeOperation = "source-over";

      const ordered = [...agents, ...tools].sort((a, b) => a.z - b.z);
      for (const n of ordered) {
        const depth = (n.z + 1) / 2;
        const alpha = 0.45 + 0.55 * depth;
        if (n.kind === "agent") {
          if (n.flash > 0) glow(n.x, n.y, 34 * n.s, n.flashColor, 0.55 * n.flash);
          glow(n.x, n.y, 18 * n.s, C.agent, 0.35 * alpha);
          ctx.fillStyle = `rgba(14,38,92,${alpha})`;
          ctx.strokeStyle = `rgba(${C.agent},${0.85 * alpha})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(n.x, n.y, 7 * n.s, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = `rgba(${C.agent},${alpha})`;
          ctx.beginPath();
          ctx.arc(n.x, n.y, 2.6 * n.s, 0, Math.PI * 2);
          ctx.fill();
          chip(n.x, n.y + 22 * n.s, n.label, alpha, C.agent, 11 * n.s);
        } else {
          if (n.flash > 0) glow(n.x, n.y, 30 * n.s, n.flashColor, 0.6 * n.flash);
          const accent = n.gated ? "255,200,120" : C.tool;
          chip(n.x, n.y, n.label, alpha, accent, 11.5 * n.s);
          if (n.gated) {
            ctx.fillStyle = `rgba(${C.amber},${0.9 * alpha})`;
            ctx.beginPath();
            ctx.arc(n.x + (ctx.measureText(n.label).width / 2 + 8), n.y - (11.5 * n.s + 10) / 2 + 1, 2.4, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      if (!reduce && !document.hidden) raf = requestAnimationFrame(frame);
    };

    const onVisible = () => {
      if (!reduce && !document.hidden) {
        cancelAnimationFrame(raf);
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    window.addEventListener("pointermove", onMove);
    document.addEventListener("visibilitychange", onVisible);
    if (!reduce) raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
