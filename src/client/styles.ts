export const css = `
  .osd { position:relative; box-sizing:border-box; height:100%; overflow:auto; padding:0 8px 28px; background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-primary); font:inherit; font-size:13px; line-height:1.5; }
  .osd * { box-sizing:border-box; } .osd button,.osd input { font:inherit; }
  .osd-controls { position:sticky; top:0; z-index:2; padding-top:16px; background:var(--dsw-alias-bg-base); box-shadow:0 1px 0 var(--dsw-alias-border-l1); }
  .osd h1 { margin:0; font-size:17px; font-weight:650; } .osd-muted { color:var(--dsw-alias-label-secondary); }
  .osd-head { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:12px; }
  .osd-control { background:transparent; border:0; color:inherit; cursor:pointer; border-radius:8px; padding:6px 9px; }
  .osd-control:hover,.osd-row:hover,.osd-file:hover { background:var(--dsw-alias-bg-layer-2); }
  .osd-control:focus-visible,.osd-row:focus-visible,.osd-file:focus-visible,.osd-search:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:1px; }
  .osd-view { display:flex; gap:5px; border-bottom:1px solid var(--dsw-alias-border-l1); padding-bottom:9px; }
  .osd-view .osd-control[aria-pressed="true"] { background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-brand-primary); font-weight:650; }
  .osd-toolbar { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:4px 12px; min-height:50px; padding:12px 0 10px; }
  .osd-filter { display:flex; flex-shrink:0; align-items:center; gap:2px; min-height:28px; } .osd-filter .osd-control { padding:5px 7px; font-size:12px; }
  .osd-filter-label { padding:5px 7px; font-size:12px; line-height:18px; color:var(--dsw-alias-label-secondary); }
  .osd-filter .osd-control[aria-pressed="true"] { background:var(--dsw-alias-bg-layer-2); font-weight:650; }
  .osd-count { flex:none; font-size:11px; margin-left:auto; text-align:right; max-width:100%; white-space:normal; overflow-wrap:anywhere; line-height:1.5; } .osd-search { width:100%; background:var(--dsw-alias-bg-layer-1); border:1px solid var(--dsw-alias-border-l1); border-radius:9px; color:inherit; padding:7px 10px; margin-bottom:12px; }
  .osd-card { border:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-1); border-radius:10px; margin-bottom:8px; overflow:hidden; }
  .osd-row { display:block; text-align:left; width:100%; padding:11px 12px; border:0; background:transparent; color:inherit; cursor:pointer; }
  .osd-row-head { display:flex; align-items:flex-start; justify-content:space-between; gap:8px; }
  .osd-title { display:block; min-width:0; font-weight:650; overflow-wrap:anywhere; line-height:1.4; }
  .osd-tag { display:inline-flex; flex:none; align-items:center; border-radius:6px; padding:3px 8px; font-size:11px; font-weight:600; line-height:1.4; white-space:nowrap; }
  .osd-tag[data-kind="archived"],.osd-tag[data-kind="otherTag"] { color:color-mix(in srgb,var(--dsw-alias-label-primary) 78%,var(--dsw-alias-bg-layer-1)); background:color-mix(in srgb,var(--dsw-alias-label-primary) 12%,var(--dsw-alias-bg-layer-1)); }
  .osd-tag[data-kind="confirmedSpec"] { color:color-mix(in srgb,var(--dsw-alias-label-primary) 78%,var(--dsw-alias-bg-layer-1)); background:color-mix(in srgb,var(--dsw-alias-label-primary) 12%,var(--dsw-alias-bg-layer-1)); }
  .osd-tag[data-kind="changedSpec"] { color:var(--dsw-alias-state-warn-primary); background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent); }
  .osd-tag[data-kind="newSpec"] { --osd-hue:#0c86ad; color:color-mix(in srgb,var(--osd-hue) 80%,var(--dsw-alias-label-primary)); background:color-mix(in srgb,var(--osd-hue) 12%,transparent); }
  .osd-tag[data-kind="underway"],.osd-tag[data-kind="groupOngoing"],.osd-tag[data-kind="designTag"] { color:var(--dsw-alias-state-warn-primary); background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent); }
  .osd-tag[data-kind="preparing"] { color:var(--dsw-alias-brand-primary); background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent); }
  .osd-tag[data-kind="goalTag"] { --osd-hue:#4075d2; color:color-mix(in srgb,var(--osd-hue) 80%,var(--dsw-alias-label-primary)); background:color-mix(in srgb,var(--osd-hue) 12%,transparent); }
  .osd-tag[data-kind="specTag"] { --osd-hue:#7955c3; color:color-mix(in srgb,var(--osd-hue) 80%,var(--dsw-alias-label-primary)); background:color-mix(in srgb,var(--osd-hue) 12%,transparent); }
  .osd-tag[data-kind="done"],.osd-tag[data-kind="groupDone"],.osd-tag[data-kind="tasksTag"] { color:var(--dsw-alias-state-success-primary); background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent); }
  .osd-description { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; font-size:12px; margin:4px 0 0; }
  .osd-status { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:8px; font-size:11px; }
  .osd-track { width:64px; height:4px; border-radius:2px; background:var(--dsw-alias-bg-layer-2); overflow:hidden; }
  .osd-track span { display:block; height:100%; background:var(--dsw-alias-brand-primary); }
  .osd-children { border-top:1px solid var(--dsw-alias-border-l1); padding:8px; }
  .osd-spec-source + .osd-spec-source { border-top:1px solid var(--dsw-alias-border-l1); margin-top:6px; padding-top:6px; }
  .osd-spec-source-title { color:var(--dsw-alias-label-secondary); font-size:11px; font-weight:600; padding:4px 8px; overflow-wrap:anywhere; }
  .osd-child-tabs { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:3px 6px; margin-bottom:6px; }
  .osd-child-tab-buttons { display:flex; gap:3px; } .osd-child-tabs .osd-control { font-size:12px; padding:4px 9px; }
  .osd-child-tabs [aria-pressed="true"] { background:var(--dsw-alias-bg-layer-2); font-weight:650; }
  .osd-incomplete-filter { display:inline-flex; align-items:center; gap:4px; margin-left:auto; font-size:11px; cursor:pointer; white-space:nowrap; }
  .osd-incomplete-filter input { margin:0; accent-color:var(--dsw-alias-brand-primary); cursor:pointer; }
  .osd-incomplete-filter input:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:2px; }
  .osd-file { display:flex; align-items:center; gap:8px; width:100%; padding:6px 8px; background:transparent; border:0; border-radius:6px; color:var(--dsw-alias-label-primary); text-align:left; cursor:pointer; overflow-wrap:anywhere; font-size:12px; }
  .osd-group { margin:5px 0 8px; border:1px solid var(--dsw-alias-border-l1); border-radius:8px; overflow:hidden; }
  .osd-group-button { display:flex; align-items:center; gap:7px; width:100%; border:0; background:var(--dsw-alias-bg-layer-2); color:inherit; padding:7px 8px; text-align:left; cursor:pointer; }
  .osd-group-button:hover { background:var(--dsw-alias-bg-layer-1); }
  .osd-group-title { flex:1; min-width:0; font-size:12px; font-weight:600; overflow-wrap:anywhere; }
  .osd-group-count { margin-left:8px; color:var(--dsw-alias-label-secondary); font-weight:400; white-space:nowrap; }
  .osd-chevron { color:var(--dsw-alias-label-secondary); }
  .osd-group-button:focus-visible,.osd-task input:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:-2px; }
  .osd-task { padding:7px 8px; display:flex; align-items:flex-start; gap:8px; font-size:12px; }
  .osd-task-row + .osd-task-row { border-top:1px solid var(--dsw-alias-border-l1); }
  .osd-task-feedback { margin:0 8px 7px 30px; color:var(--dsw-alias-state-error-primary); font-size:11px; }
  .osd-task input { margin:2px 0 0; flex:none; accent-color:var(--dsw-alias-brand-primary); cursor:pointer; }
  .osd-task input:disabled { cursor:not-allowed; } .osd-task[data-done="true"] { color:var(--dsw-alias-label-secondary); }
  .osd-state { color:var(--dsw-alias-label-secondary); text-align:center; padding:22px 8px; } .osd-notice { padding:8px; margin:7px 0; border:1px solid var(--dsw-alias-border-l1); border-radius:8px; font-size:12px; }
`;
