// Desktop shell styles (scoped under .mw-shell). Dark navy foundation, subtle borders, one restrained gold
// primary action, teal for the assistant; system-ui text (no font loading) and a system serif for short
// mathematical names on choice cards and formulas.

import { INSPECTOR_WIDTH as IW } from './logic'

const CSS = String.raw`
.mw-shell {
  --mw-bg: #0b0e15;
  --mw-panel: rgba(18, 23, 35, 0.84);
  --mw-panel-strong: rgba(16, 21, 32, 0.97);
  --mw-pop: #10151f;
  --mw-card: rgba(255, 255, 255, 0.028);
  --mw-card-hover: rgba(255, 255, 255, 0.06);
  --mw-line: rgba(160, 178, 214, 0.13);
  --mw-line-strong: rgba(160, 178, 214, 0.26);
  --mw-text: #e9edf5;
  --mw-strong: #f4f6fb;
  --mw-sub: #a9b6d6;
  --mw-dim: #b0b8c8;
  --mw-faint: #8a94a8;
  --mw-gold: #ffc95c;
  --mw-gold-ink: #1d1505;
  --mw-teal: #4fd1c5;
  --mw-teal-soft: rgba(79, 209, 197, 0.13);
  --mw-rose: #ff8fa3;
  --mw-amber: #ffb86b;
  --mw-blue: #9fcbff;
  --mw-violet: #c9b8ff;
  --mw-focus: #9cc2ff;
  --mw-shadow: 0 16px 44px rgba(0, 0, 0, 0.36);
  --mw-font: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  --mw-math: 'STIX Two Math', 'STIX Two Text', 'Cambria Math', 'Latin Modern Math', Georgia, 'Times New Roman', serif;
  --mw-insp-w: clamp(${IW.min}px, ${IW.vw}vw, ${IW.max}px);

  position: fixed;
  inset: 0;
  z-index: 1;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 0;
  grid-template-rows: auto minmax(0, 1fr) auto auto;
  background: var(--mw-bg);
  color: var(--mw-text);
  font: 15px/1.4 var(--mw-font);
  -webkit-font-smoothing: antialiased;
  pointer-events: none;
  overflow: hidden;
}
.mw-shell[data-inspector] { grid-template-columns: minmax(0, 1fr) var(--mw-insp-w); }
.mw-shell *, .mw-shell *::before, .mw-shell *::after { box-sizing: border-box; }
.mw-shell [hidden] { display: none !important; }
.mw-shell button { font-family: var(--mw-font); -webkit-tap-highlight-color: transparent; }
.mw-shell :focus-visible { outline: 2px solid var(--mw-focus); outline-offset: 2px; }
.mw-shell .mw-icon { flex: none; display: block; }

/* ---------------------------------------------------------------- stage */
.mw-stage-slot { grid-column: 1; grid-row: 1 / -1; position: relative; min-height: 0; min-width: 0; overflow: hidden; pointer-events: auto; z-index: 0; }
.mw-stage-slot > .mw-stage { position: absolute !important; inset: 0 !important; width: 100% !important; height: 100% !important; }
.mw-shell[data-inspector]:not([data-narrow]) .mw-stage-slot::after {
  content: ''; position: absolute; top: 0; bottom: 0; right: 0; width: 56px; pointer-events: none;
  background: linear-gradient(90deg, rgba(11, 14, 21, 0), var(--mw-bg));
}

/* ---------------------------------------------------------------- question / context header */
.mw-header { grid-column: 1; grid-row: 1; justify-self: start; align-self: start; z-index: 1; pointer-events: auto; margin: 34px 0 0 44px; max-width: min(36rem, 46%); }
.mw-question { margin: 0; font: 600 clamp(28px, 2.6vw, 40px)/1.13 var(--mw-font); letter-spacing: -0.015em; color: var(--mw-strong); text-wrap: balance; }
.mw-subtitle { margin: 12px 0 0; font: 400 clamp(16px, 1.25vw, 19px)/1.3 var(--mw-font); color: var(--mw-sub); letter-spacing: 0.005em; }

/* ---------------------------------------------------------------- dock: context actions + status */
.mw-dock { grid-column: 1; grid-row: 3; justify-self: center; align-self: end; z-index: 1; margin: 0 16px 12px; max-width: calc(100% - 32px); display: flex; flex-direction: column; align-items: stretch; gap: 8px; pointer-events: none; }
.mw-dock > * { pointer-events: auto; }
.mw-context { background: var(--mw-panel); border: 1px solid var(--mw-line); border-radius: 18px; padding: 14px 18px 16px; box-shadow: var(--mw-shadow); backdrop-filter: blur(14px) saturate(1.1); -webkit-backdrop-filter: blur(14px) saturate(1.1); }
.mw-context-title { margin: 0 0 11px 2px; font: 500 15px/1.3 var(--mw-font); color: var(--mw-dim); }
.mw-context-body { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 14px 22px; }
.mw-group { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
.mw-group-label { font: 600 11.5px/1 var(--mw-font); letter-spacing: 0.07em; text-transform: uppercase; color: var(--mw-faint); margin-left: 2px; }
/* Every item row is as tall as a card, so group labels line up across groups (cards 62 px, buttons 44 px). */
.mw-group-items { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; min-height: 62px; }

.mw-choice {
  position: relative; min-width: 62px; height: 62px; padding: 0 16px; border-radius: 13px;
  background: var(--mw-card); border: 1px solid var(--mw-line-strong); color: var(--mw-text);
  font: 500 16px/1.15 var(--mw-font); cursor: pointer; transition: background-color 120ms, border-color 120ms;
}
.mw-choice.is-short { font: 400 27px/1 var(--mw-math); }
.mw-choice:hover { background: var(--mw-card-hover); border-color: rgba(160, 178, 214, 0.42); }
.mw-choice[aria-pressed='true'] { border: 2px solid var(--mw-gold); padding: 0 15px; background: rgba(255, 201, 92, 0.07); box-shadow: 0 0 0 4px rgba(255, 201, 92, 0.07); }
.mw-check { position: absolute; top: -9px; right: -9px; width: 22px; height: 22px; border-radius: 50%; display: none; place-items: center; background: var(--mw-gold); color: var(--mw-gold-ink); box-shadow: 0 0 0 3px #131927; }
.mw-choice[aria-pressed='true'] .mw-check { display: grid; }

.mw-primary {
  display: inline-flex; align-items: center; gap: 16px; height: 62px; padding: 0 22px 0 26px; border: 0; border-radius: 13px;
  background: linear-gradient(180deg, #ffd77a 0%, #f4b843 100%); color: var(--mw-gold-ink);
  font: 650 19px/1 var(--mw-font); letter-spacing: -0.005em; cursor: pointer; white-space: nowrap;
  box-shadow: 0 8px 22px rgba(244, 184, 67, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.35);
}
.mw-primary:hover { filter: brightness(1.05); }
.mw-primary:focus-visible { outline-offset: 3px; }
.mw-primary[aria-disabled='true'] { background: rgba(255, 201, 92, 0.13); color: rgba(255, 228, 175, 0.5); box-shadow: none; filter: none; }

.mw-secondary {
  display: inline-flex; align-items: center; gap: 8px; height: 44px; padding: 0 16px; border-radius: 12px;
  background: transparent; border: 1px solid var(--mw-line-strong); color: var(--mw-dim);
  font: 500 14.5px/1 var(--mw-font); cursor: pointer; white-space: nowrap; transition: background-color 120ms, color 120ms;
}
.mw-secondary:hover { color: var(--mw-text); background: rgba(255, 255, 255, 0.045); }
.mw-secondary.is-toggle .mw-icon { opacity: 0; width: 0; margin-right: -8px; transition: none; }
.mw-secondary.is-toggle[aria-pressed='true'] { color: var(--mw-text); border-color: rgba(255, 201, 92, 0.55); background: rgba(255, 201, 92, 0.06); }
.mw-secondary.is-toggle[aria-pressed='true'] .mw-icon { opacity: 1; width: 16px; margin-right: 0; color: var(--mw-gold); }
.mw-shell [aria-disabled='true'] { cursor: not-allowed; }
.mw-choice[aria-disabled='true'], .mw-secondary[aria-disabled='true'] { opacity: 0.5; background: transparent; }

.mw-hint { display: flex; align-items: flex-start; gap: 9px; margin: 13px 2px 0; font: 500 15px/1.4 var(--mw-font); color: var(--mw-text); }
.mw-hint .mw-icon { color: var(--mw-gold); margin-top: 1px; }

.mw-status { display: flex; align-items: center; gap: 12px; min-height: 34px; padding: 0 4px 0 14px; font: 400 15px/1.35 var(--mw-font); color: var(--mw-dim); }
.mw-dock[data-context='none'] .mw-status { background: var(--mw-panel); border: 1px solid var(--mw-line); border-radius: 14px; padding: 4px 6px 4px 14px; backdrop-filter: blur(14px); }
.mw-dot { flex: none; width: 10px; height: 10px; border-radius: 50%; background: #7e89a3; box-shadow: 0 0 0 3px rgba(126, 137, 163, 0.14); }
.mw-status[data-phase='animating'] .mw-dot { background: var(--mw-teal); box-shadow: 0 0 0 3px rgba(79, 209, 197, 0.16); animation: mw-pulse 1.3s ease-in-out infinite; }
.mw-status[data-phase='paused'] .mw-dot { background: var(--mw-amber); box-shadow: 0 0 0 3px rgba(255, 184, 107, 0.14); }
.mw-status[data-phase='result'] .mw-dot { background: var(--mw-gold); box-shadow: 0 0 0 3px rgba(255, 201, 92, 0.16); }
.mw-status[data-tone='warning'] .mw-status-text { color: var(--mw-amber); }
.mw-status[data-tone='error'] .mw-status-text { color: var(--mw-rose); }
.mw-status[data-tone='error'] .mw-dot { background: var(--mw-rose); }
.mw-status-text { flex: 1 1 auto; min-width: 0; }
.mw-status-sep { flex: none; width: 1px; height: 22px; background: var(--mw-line-strong); }
.mw-math-toggle { flex: none; display: inline-flex; align-items: center; gap: 4px; padding: 6px 8px 6px 10px; border: 0; border-radius: 9px; background: transparent; color: var(--mw-dim); font: 500 15px/1 var(--mw-font); cursor: pointer; white-space: nowrap; }
.mw-math-toggle:hover { color: var(--mw-text); background: rgba(255, 255, 255, 0.045); }
.mw-math-toggle[aria-expanded='true'] { color: var(--mw-text); }
.mw-math-toggle[aria-expanded='true'] .mw-icon { transform: rotate(180deg); }
.mw-notice-inline { margin: 0 4px 0 14px; font-size: 13.5px; color: var(--mw-rose); overflow-wrap: anywhere; }

@keyframes mw-pulse { 50% { opacity: 0.45; } }

/* ---------------------------------------------------------------- toolbar */
.mw-tools { grid-column: 1; grid-row: 4; justify-self: center; z-index: 2; margin: 0 16px 20px; position: relative; pointer-events: auto; max-width: calc(100% - 32px); }
.mw-toolbar { display: flex; align-items: center; gap: 4px; padding: 7px; border-radius: 20px; background: var(--mw-panel); border: 1px solid var(--mw-line); box-shadow: var(--mw-shadow); backdrop-filter: blur(14px) saturate(1.1); -webkit-backdrop-filter: blur(14px) saturate(1.1); }
.mw-tb-row { display: flex; align-items: center; gap: 4px; }
.mw-tb-row + .mw-tb-row::before { content: ''; width: 1px; height: 26px; margin: 0 6px; background: var(--mw-line-strong); }
.mw-tb-sep { width: 1px; height: 26px; margin: 0 6px; background: var(--mw-line-strong); }
.mw-tb-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 9px; height: 46px; padding: 0 16px; border-radius: 14px;
  border: 1px solid transparent; background: transparent; color: var(--mw-text); font: 500 15.5px/1 var(--mw-font);
  cursor: pointer; white-space: nowrap; transition: background-color 120ms, border-color 120ms, color 120ms;
}
.mw-tb-btn:hover { background: rgba(255, 255, 255, 0.06); }
.mw-tb-btn .mw-icon { color: var(--mw-sub); }
.mw-tb-btn[data-id='play'] { min-width: 104px; justify-content: flex-start; }
/* Undo reserves "Cancel drag" (its label during a drag), so starting a drag never wraps the toolbar. */
.mw-tb-btn[data-id='undo'] { min-width: 150px; justify-content: flex-start; }
.mw-tb-btn.is-active { background: rgba(255, 255, 255, 0.08); border-color: var(--mw-line-strong); }
.mw-tb-btn[data-id='assistant'] .mw-icon { color: var(--mw-teal); }
.mw-tb-btn[data-id='assistant'].is-active { background: var(--mw-teal-soft); border-color: rgba(79, 209, 197, 0.62); color: #e4fbf8; box-shadow: 0 0 0 1px rgba(79, 209, 197, 0.12), 0 0 18px rgba(79, 209, 197, 0.12); }
.mw-tb-btn[aria-disabled='true'] { color: var(--mw-faint); opacity: 0.6; background: transparent; }
.mw-tb-btn[aria-disabled='true'] .mw-icon { color: var(--mw-faint); }
.mw-tb-btn .mw-caret { color: var(--mw-faint); margin-left: -2px; }
.mw-tb-btn[aria-expanded='true'] .mw-caret { transform: rotate(180deg); }
.mw-shell[data-tight] .mw-toolbar { flex-direction: column; align-items: stretch; gap: 4px; }
.mw-shell[data-tight] .mw-tb-row { justify-content: center; }
.mw-shell[data-tight] .mw-tb-row + .mw-tb-row { border-top: 1px solid var(--mw-line); padding-top: 5px; }
.mw-shell[data-tight] .mw-tb-row + .mw-tb-row::before { display: none; }

/* ---------------------------------------------------------------- popovers */
.mw-pop { position: absolute; bottom: calc(100% + 12px); z-index: 5; max-height: min(72vh, 680px); overflow: auto; padding: 16px; background: var(--mw-pop); border: 1px solid var(--mw-line); border-radius: 18px; box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5); }
.mw-pop--experiments { left: 0; width: min(720px, calc(100vw - 32px)); }
.mw-pop--more { right: 0; width: min(400px, calc(100vw - 32px)); }
.mw-pop-title { margin: 2px 4px 12px; font: 600 12px/1 var(--mw-font); letter-spacing: 0.08em; text-transform: uppercase; color: var(--mw-faint); }
.mw-pick-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.mw-shell[data-tight] .mw-pick-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
/* A field's block is as wide as its cards (--span), so short fields share a row; on a narrower grid it takes the row. */
.mw-pick-group { grid-column: span var(--span, 1); display: grid; grid-template-columns: repeat(var(--span, 1), minmax(0, 1fr)); gap: 10px; align-content: start; }
.mw-shell[data-tight] .mw-pick-group, .mw-shell[data-narrow] .mw-pick-group { grid-column: 1 / -1; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.mw-pick-field { grid-column: 1 / -1; margin: 6px 4px 0; font: 600 11px/1 var(--mw-font); letter-spacing: 0.08em; text-transform: uppercase; color: var(--mw-sub); }
.mw-pick {
  position: relative; display: flex; align-items: flex-start; gap: 12px; min-height: 96px; padding: 14px 14px 14px 12px; border-radius: 14px;
  background: var(--mw-card); border: 1px solid var(--mw-line); color: var(--mw-text); text-align: left; cursor: pointer; transition: background-color 120ms, border-color 120ms;
}
.mw-pick:hover { background: var(--mw-card-hover); border-color: var(--mw-line-strong); }
.mw-pick[aria-current='true'] { border: 2px solid var(--mw-gold); padding: 13px 13px 13px 11px; background: rgba(255, 201, 92, 0.06); }
.mw-pick-icon { flex: none; display: grid; place-items: center; width: 38px; height: 38px; border-radius: 11px; background: rgba(255, 255, 255, 0.045); color: var(--mw-sub); }
.mw-pick[aria-current='true'] .mw-pick-icon { color: var(--mw-gold); background: rgba(255, 201, 92, 0.1); }
.mw-pick-q { display: block; font: 600 15px/1.3 var(--mw-font); color: var(--mw-strong); }
.mw-pick-t { display: block; margin-top: 6px; font: 400 13px/1.3 var(--mw-font); color: var(--mw-dim); }
.mw-pick .mw-check { display: none; top: -9px; right: -9px; }
.mw-pick[aria-current='true'] .mw-check { display: grid; }

.mw-more-sec + .mw-more-sec { margin-top: 8px; padding-top: 10px; border-top: 1px solid var(--mw-line); }
.mw-more-title { margin: 2px 10px 6px; font: 600 11.5px/1 var(--mw-font); letter-spacing: 0.08em; text-transform: uppercase; color: var(--mw-faint); }
.mw-more-item { display: flex; align-items: flex-start; gap: 12px; width: 100%; padding: 9px 10px; border: 0; border-radius: 10px; background: transparent; color: var(--mw-text); font: 500 14.5px/1.3 var(--mw-font); text-align: left; cursor: pointer; }
.mw-more-item:hover { background: rgba(255, 255, 255, 0.05); }
.mw-more-item .mw-icon { color: var(--mw-sub); margin-top: 0; }
.mw-more-item[aria-disabled='true'] { color: var(--mw-faint); background: transparent; }
.mw-more-item[aria-disabled='true'] .mw-icon { color: var(--mw-faint); }
.mw-more-label { display: block; }
.mw-more-helper { display: block; margin-top: 3px; font: 400 12.5px/1.38 var(--mw-font); color: var(--mw-dim); }
.mw-more-item[aria-disabled='true'] .mw-more-helper { color: var(--mw-faint); }
.mw-more-item[aria-expanded='true'] { background: rgba(255, 255, 255, 0.05); }
.mw-rep { margin: 4px 8px 6px 42px; padding: 10px 12px 12px; border-radius: 12px; background: rgba(255, 255, 255, 0.03); border: 1px solid var(--mw-line); }
.mw-rep-name { margin: 0 0 6px; font-size: 12.5px; color: var(--mw-dim); }
.mw-rep label { display: flex; align-items: center; gap: 9px; padding: 4px 0; font-size: 14px; color: var(--mw-dim); cursor: pointer; }
.mw-rep label.is-on { color: var(--mw-text); }
.mw-rep input { accent-color: var(--mw-gold); width: 16px; height: 16px; margin: 0; }
.mw-rep-save { margin-top: 9px; height: 36px; padding: 0 14px; border-radius: 10px; border: 1px solid rgba(255, 201, 92, 0.55); background: rgba(255, 201, 92, 0.08); color: #ffe2a6; font: 600 14px/1 var(--mw-font); cursor: pointer; }
.mw-rep-save:hover { background: rgba(255, 201, 92, 0.14); }
.mw-rep-save[aria-disabled='true'] { opacity: 0.5; }
.mw-notice { margin: 12px 4px 0; padding: 9px 12px; border-radius: 10px; background: rgba(255, 255, 255, 0.04); border: 1px solid var(--mw-line); font-size: 13px; line-height: 1.4; color: var(--mw-dim); overflow-wrap: anywhere; max-height: 9em; overflow: auto; }
.mw-notice[data-tone='error'] { color: var(--mw-rose); border-color: rgba(255, 143, 163, 0.35); background: rgba(255, 143, 163, 0.06); }

/* ---------------------------------------------------------------- side inspector */
.mw-inspector { grid-column: 2; grid-row: 1 / -1; z-index: 1; min-height: 0; min-width: 0; display: flex; flex-direction: column; padding: 24px 24px 24px 4px; pointer-events: auto; }
.mw-insp-card { display: flex; flex-direction: column; min-height: 0; max-height: 100%; background: var(--mw-panel-strong); border: 1px solid var(--mw-line); border-radius: 20px; box-shadow: var(--mw-shadow); overflow: hidden; }
.mw-insp-card[data-mode='assistant'] { border-color: rgba(79, 209, 197, 0.24); box-shadow: var(--mw-shadow), 0 0 34px rgba(79, 209, 197, 0.06); }
.mw-insp-card[data-mode='assistant']::before { content: ''; display: block; height: 2px; background: linear-gradient(90deg, rgba(79, 209, 197, 0), rgba(79, 209, 197, 0.75), rgba(79, 209, 197, 0)); }
.mw-insp-head { display: flex; align-items: center; gap: 10px; padding: 20px 14px 10px 24px; }
.mw-insp-title { flex: 1 1 auto; min-width: 0; margin: 0; font: 600 22px/1.2 var(--mw-font); color: var(--mw-strong); letter-spacing: -0.01em; }
.mw-insp-close { flex: none; display: grid; place-items: center; width: 38px; height: 38px; border: 0; border-radius: 11px; background: transparent; color: var(--mw-dim); cursor: pointer; }
.mw-insp-close:hover { color: var(--mw-text); background: rgba(255, 255, 255, 0.06); }
.mw-insp-body { min-height: 0; overflow: auto; overscroll-behavior: contain; }
.mw-assistant-slot { padding: 0 24px 22px; }
.mw-math { padding: 0 24px 22px; }

/* mathematics detail */
.mw-sec { padding: 14px 0 12px; border-top: 1px solid var(--mw-line); }
.mw-sec:first-child { border-top: 0; padding-top: 4px; }
.mw-sec-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
.mw-sec-title { margin: 0; font: 600 15px/1.3 var(--mw-font); color: var(--mw-strong); }
.mw-prov { flex: none; padding: 3px 8px; border-radius: 999px; border: 1px solid var(--mw-line-strong); font: 500 11.5px/1.2 var(--mw-font); color: var(--mw-dim); white-space: nowrap; }
.mw-prov[data-prov='computed exactly'] { border-color: rgba(159, 203, 255, 0.4); color: var(--mw-blue); }
.mw-prov[data-prov='checked by supported rewrite rules'] { border-color: rgba(201, 184, 255, 0.45); color: var(--mw-violet); }
.mw-prov[data-prov='Lean receipt'] { border-color: rgba(79, 209, 197, 0.5); color: var(--mw-teal); }
.mw-prov[data-prov='presentation'] { color: var(--mw-faint); }
.mw-d-text { margin: 6px 0; font-size: 14.5px; line-height: 1.5; color: var(--mw-dim); }
.mw-d-formula { margin: 8px 0; font: 400 18px/1.4 var(--mw-math); color: var(--mw-text); overflow-wrap: anywhere; }
.mw-d-matrix { display: flex; align-items: center; gap: 10px; margin: 10px 0; font: 400 17px/1.25 var(--mw-math); color: var(--mw-text); }
.mw-matrix { position: relative; display: inline-grid; column-gap: 18px; row-gap: 3px; padding: 5px 13px; }
.mw-matrix::before, .mw-matrix::after { content: ''; position: absolute; top: 0; bottom: 0; width: 7px; border: 1.5px solid var(--mw-dim); }
.mw-matrix::before { left: 0; border-right: 0; }
.mw-matrix::after { right: 0; border-left: 0; }
.mw-matrix span { text-align: right; font-variant-numeric: tabular-nums; }
.mw-d-pairs { display: grid; grid-template-columns: minmax(0, auto) minmax(0, 1fr); gap: 5px 14px; margin: 8px 0; font-size: 14.5px; }
.mw-d-pairs dt { color: var(--mw-dim); }
.mw-d-pairs dd { margin: 0; color: var(--mw-text); overflow-wrap: anywhere; }
.mw-d-list { margin: 6px 0; padding-left: 18px; font-size: 14.5px; color: var(--mw-text); }
.mw-d-list li { margin: 3px 0; }
.mw-d-list li::marker { color: var(--mw-faint); }
.mw-ev { list-style: none; margin: 8px 0; padding: 0; display: grid; gap: 8px; }
.mw-ev li { padding: 10px 12px; border-radius: 12px; background: rgba(255, 255, 255, 0.03); border: 1px solid var(--mw-line); }
.mw-ev li[data-current='false'] { opacity: 0.68; border-style: dashed; }
.mw-ev-head { display: flex; align-items: flex-start; gap: 8px; }
.mw-ev-label { flex: 1 1 auto; font-size: 14px; color: var(--mw-text); }
.mw-ev-status { flex: none; padding: 2px 8px; border-radius: 999px; font: 600 11.5px/1.3 var(--mw-font); background: rgba(255, 255, 255, 0.06); color: var(--mw-dim); white-space: nowrap; }
.mw-ev-status[data-status='checked'] { background: rgba(79, 209, 197, 0.14); color: var(--mw-teal); }
.mw-ev-status[data-status='computed'] { background: rgba(159, 203, 255, 0.12); color: var(--mw-blue); }
.mw-ev-status[data-status='checking'] { background: rgba(255, 184, 107, 0.12); color: var(--mw-amber); }
.mw-ev-status[data-status='not_established'] { background: rgba(255, 184, 107, 0.12); color: var(--mw-amber); }
.mw-ev-status[data-status='error'] { background: rgba(255, 143, 163, 0.12); color: var(--mw-rose); }
.mw-ev-stmt { margin: 7px 0 0; font: 400 13px/1.45 ui-monospace, 'SF Mono', Menlo, Consolas, monospace; color: var(--mw-text); overflow-wrap: anywhere; white-space: pre-wrap; }
.mw-ev-meta { margin: 6px 0 0; font-size: 12.5px; color: var(--mw-faint); }
.mw-ev-hist { color: var(--mw-amber); }
.mw-d-action { margin: 8px 0 4px; }

/* ---------------------------------------------------------------- stacked (narrow window, or a stage column under
   900 px beside an open inspector): nothing over the stage. The stage row keeps priority (--mw-stage-min, set by
   desktop.ts: 40 % of the height unless the other rows need it); the drawer takes what is left, up to 30vh. */
.mw-shell[data-narrow] { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(var(--mw-stage-min, max(150px, 40vh)), 1fr) auto auto auto; }
.mw-shell[data-narrow] .mw-header { grid-row: 1; margin: 14px 16px 8px; max-width: none; }
.mw-shell[data-narrow] .mw-question { font-size: clamp(22px, 5.4vw, 30px); }
.mw-shell[data-narrow] .mw-subtitle { margin-top: 6px; }
.mw-shell[data-narrow] .mw-stage-slot { grid-row: 2; }
.mw-shell[data-narrow] .mw-dock { grid-row: 3; justify-self: stretch; margin: 10px 12px 0; max-width: none; }
.mw-shell[data-narrow] .mw-context { padding: 12px 14px 14px; }
.mw-shell[data-narrow] .mw-inspector { grid-column: 1; grid-row: 4; max-height: 30vh; padding: 10px 12px 0; }
.mw-shell[data-narrow] .mw-insp-head { padding: 12px 10px 6px 18px; }
.mw-shell[data-narrow] .mw-insp-title { font-size: 19px; }
.mw-shell[data-narrow] .mw-assistant-slot, .mw-shell[data-narrow] .mw-math { padding: 0 18px 16px; }
.mw-shell[data-narrow] .mw-tools { grid-row: 5; justify-self: stretch; margin: 10px 12px 12px; max-width: none; }
.mw-shell[data-narrow] .mw-toolbar { justify-content: safe center; }
.mw-shell[data-narrow] .mw-tb-btn { padding: 0 12px; }
.mw-shell[data-narrow] .mw-pick-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
@media (max-width: 560px) { .mw-shell[data-narrow] .mw-pick-grid, .mw-shell[data-narrow] .mw-pick-group { grid-template-columns: minmax(0, 1fr); } }

/* Optional clean-stage view (spec section 8): hides all chrome together, so no answer loses its source label; the
   stage keeps the whole window (no reserved inspector column, no edge fade). */
body.clean-stage .mw-shell > :not(.mw-stage-slot) { display: none !important; }
body.clean-stage .mw-shell { grid-template-columns: minmax(0, 1fr) 0; }
body.clean-stage .mw-stage-slot::after { display: none; }

@media (prefers-reduced-motion: reduce) {
  .mw-shell *, .mw-shell *::before, .mw-shell *::after { animation: none !important; transition: none !important; }
}

/* Short windows (under 760 px tall, side-by-side layout): the chrome steps down a size so the stage keeps a
   usable band (spec section 3: the experiment stays the largest region). */
@media (max-height: 760px) {
  .mw-shell:not([data-narrow]) .mw-header { margin: 18px 0 0 32px; }
  .mw-shell:not([data-narrow]) .mw-question { font-size: clamp(22px, 2vw, 28px); }
  .mw-shell:not([data-narrow]) .mw-subtitle { margin-top: 6px; font-size: 15px; }
  .mw-shell:not([data-narrow]) .mw-context { padding: 10px 14px 12px; }
  .mw-shell:not([data-narrow]) .mw-context-title { margin-bottom: 7px; font-size: 14px; }
  .mw-shell:not([data-narrow]) .mw-group-items { min-height: 46px; gap: 8px; }
  .mw-shell:not([data-narrow]) .mw-choice { height: 46px; min-width: 46px; }
  .mw-shell:not([data-narrow]) .mw-choice.is-short { font-size: 22px; }
  .mw-shell:not([data-narrow]) .mw-primary { height: 46px; padding: 0 16px 0 20px; gap: 12px; font-size: 16px; }
  .mw-shell:not([data-narrow]) .mw-hint { margin-top: 8px; font-size: 14px; }
  .mw-shell:not([data-narrow]) .mw-status { min-height: 28px; font-size: 14px; }
  .mw-shell:not([data-narrow]) .mw-dock { gap: 4px; margin-bottom: 8px; }
  .mw-shell:not([data-narrow]) .mw-tools { margin-bottom: 10px; }
  .mw-shell:not([data-narrow]) .mw-toolbar { padding: 5px; }
  .mw-shell:not([data-narrow]) .mw-tb-btn { height: 40px; }
}
`

let installed: HTMLStyleElement | null = null

export function installShellStyles(doc: Document = document): void {
  if (installed && installed.isConnected) return
  const el = doc.createElement('style')
  el.id = 'mw-shell-styles'
  el.textContent = CSS
  doc.head.appendChild(el)
  installed = el
}
