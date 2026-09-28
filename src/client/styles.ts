/**
 * Stylesheet of the browser face, injected once per page load. Every class
 * carries the `relay_` prefix — plain CSS, no modules, no collision with the
 * host or sibling plugins. Colors come from the shell's design tokens
 * (--dsw-alias-*). Interactive controls (Button / Switch / Pill / Tag /
 * StateDot / Menu / Modal) come from the host-supplied primitives and carry
 * their own styles; only layout classes for placing them live here.
 */

import { CSS_PREFIX } from '../constants.js'

export const cssText = `
.${CSS_PREFIX}_section{max-width:760px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:12px;display:flex}
.${CSS_PREFIX}_title{color:var(--dsw-alias-label-primary);margin:0;font-size:16px;font-weight:500;line-height:24px}
.${CSS_PREFIX}_intro{color:var(--dsw-alias-label-tertiary);margin:0;font-size:14px;line-height:22px}
.${CSS_PREFIX}_card{background:var(--dsw-alias-bg-module-platform);border-radius:12px;flex-direction:column;gap:12px;padding:14px 16px;display:flex}
.${CSS_PREFIX}_head{align-items:flex-start;gap:12px;justify-content:space-between;display:flex}
.${CSS_PREFIX}_cardTitle{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px}
.${CSS_PREFIX}_field{flex-direction:column;gap:6px;display:flex}
.${CSS_PREFIX}_fieldLabel{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;line-height:18px}
.${CSS_PREFIX}_input{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);width:100%;height:32px;font:inherit;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 10px;font-size:14px;line-height:22px}
.${CSS_PREFIX}_input:focus{border-color:var(--dsw-alias-brand-primary);outline:none}
.${CSS_PREFIX}_input::placeholder{color:var(--dsw-alias-label-dimmed)}
.${CSS_PREFIX}_row{align-items:center;gap:8px;display:flex}
.${CSS_PREFIX}_rowEnd{justify-content:flex-end;gap:8px;display:flex}
.${CSS_PREFIX}_keyList{flex-direction:column;gap:8px;display:flex}
.${CSS_PREFIX}_keyRow{border:.5px solid var(--dsw-alias-border-l4);border-radius:10px;align-items:center;gap:10px;padding:8px 12px;display:flex}
.${CSS_PREFIX}_keyMain{flex-direction:column;gap:2px;min-width:0;flex:1 1 0;display:flex}
.${CSS_PREFIX}_keyName{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:20px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0;overflow-wrap:anywhere}
.${CSS_PREFIX}_keyMeta{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.${CSS_PREFIX}_table{flex-direction:column;display:flex}
.${CSS_PREFIX}_tr{align-items:baseline;border-bottom:.5px solid var(--dsw-alias-border-l4);gap:12px;padding:6px 0;display:flex}
.${CSS_PREFIX}_tr:last-child{border-bottom:none}
.${CSS_PREFIX}_trHead{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.${CSS_PREFIX}_td{min-width:0;overflow-wrap:anywhere;font-size:13px;line-height:20px}
.${CSS_PREFIX}_tdId{flex:2 1 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.${CSS_PREFIX}_tdPrice{flex:3 1 0}
.${CSS_PREFIX}_tdGroups{flex:1.6 1 0;color:var(--dsw-alias-label-tertiary);font-size:12px}
.${CSS_PREFIX}_msg{border-radius:8px;padding:8px 10px;font-size:12px;line-height:18px;white-space:pre-line}
.${CSS_PREFIX}_msgOk{color:var(--dsw-alias-state-success-primary);background:var(--dsw-alias-interactive-bg-hover)}
.${CSS_PREFIX}_msgErr{color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-interactive-bg-hover)}
.${CSS_PREFIX}_metaLine{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}
.${CSS_PREFIX}_empty{border:1px dashed var(--dsw-alias-border-l3);color:var(--dsw-alias-label-tertiary);text-align:center;border-radius:8px;padding:12px;font-size:12px}

.${CSS_PREFIX}_tabs{border-bottom:.5px solid var(--dsw-alias-border-l4);gap:2px;display:flex}
.${CSS_PREFIX}_tab{font:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);background:none;border:none;border-bottom:2px solid transparent;cursor:pointer;padding:6px 12px;margin-bottom:-.5px}
.${CSS_PREFIX}_tab:hover{color:var(--dsw-alias-label-primary)}
.${CSS_PREFIX}_tabActive{color:var(--dsw-alias-brand-primary);border-bottom-color:var(--dsw-alias-brand-primary);font-weight:500}
.${CSS_PREFIX}_tabPane{flex-direction:column;gap:12px;display:flex}

/* In-place editor cards (key row expansion, capability cards). */
.${CSS_PREFIX}_editCard{border:.5px solid var(--dsw-alias-border-l3);border-radius:10px;flex-direction:column;gap:10px;padding:12px 14px;display:flex;background:var(--dsw-alias-bg-layer-1)}
.${CSS_PREFIX}_formGrid{gap:10px 16px;display:grid;grid-template-columns:1fr 1fr}
.${CSS_PREFIX}_editorFooter{align-items:center;gap:8px;justify-content:flex-end;display:flex}
.${CSS_PREFIX}_footerSide{margin-right:auto}
.${CSS_PREFIX}_editorFooter button,.${CSS_PREFIX}_presetToolbar button,.${CSS_PREFIX}_capActions button,.${CSS_PREFIX}_head button{white-space:nowrap}
/* Head buttons never wrap; the title block absorbs the squeeze instead. */
.${CSS_PREFIX}_head>div:first-child{min-width:0}
.${CSS_PREFIX}_head button{flex:none}
.${CSS_PREFIX}_cardMsg{margin:0}
.${CSS_PREFIX}_checkRow{align-items:center;gap:6px;display:flex}
.${CSS_PREFIX}_radioRow{align-items:center;gap:12px;flex-wrap:wrap;display:flex}
.${CSS_PREFIX}_radio{accent-color:var(--dsw-alias-brand-primary);width:13px;height:13px;margin:0}
.${CSS_PREFIX}_formActions{justify-content:flex-end;gap:8px;align-items:center;display:flex;margin-left:auto}

/* MenuSelect anchor (the primitives Menu provides the popup itself). */
.${CSS_PREFIX}_selectAnchor{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);width:100%;height:32px;font:inherit;font-size:13px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 10px;align-items:center;justify-content:space-between;gap:6px;cursor:pointer;display:inline-flex}
.${CSS_PREFIX}_selectAnchor:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary)}
.${CSS_PREFIX}_selectAnchor:disabled{opacity:.4;cursor:default}
.${CSS_PREFIX}_selectAnchorValue{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}
.${CSS_PREFIX}_selectAnchorPlaceholder{color:var(--dsw-alias-label-dimmed)}
.${CSS_PREFIX}_selectChevron{flex:none;color:var(--dsw-alias-label-tertiary)}

.${CSS_PREFIX}_dashCards{gap:10px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr))}
.${CSS_PREFIX}_dashCard{border:.5px solid var(--dsw-alias-border-l4);border-radius:10px;flex-direction:column;gap:4px;padding:8px 10px;display:flex;min-width:0}
.${CSS_PREFIX}_dashLabel{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.${CSS_PREFIX}_dashValue{color:var(--dsw-alias-label-primary);font-size:16px;font-weight:600;line-height:22px;min-width:0;overflow-wrap:anywhere}
.${CSS_PREFIX}_dashSub{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.${CSS_PREFIX}_dashChart{border:.5px solid var(--dsw-alias-border-l4);border-radius:10px;flex-direction:column;gap:8px;padding:10px 12px;display:flex}
.${CSS_PREFIX}_dashChartHead{align-items:center;justify-content:space-between;gap:8px;display:flex}
.${CSS_PREFIX}_chart{width:100%;font-size:11px}
.${CSS_PREFIX}_chart svg{display:block}
.${CSS_PREFIX}_chartGrid{stroke:var(--dsw-alias-border-l4);stroke-dasharray:3 3}
.${CSS_PREFIX}_chartText{fill:var(--dsw-alias-label-tertiary);font-size:10px}
.${CSS_PREFIX}_chartBar:hover{opacity:.85}
.${CSS_PREFIX}_chartLine{fill:none;stroke:var(--dsw-alias-label-primary);stroke-width:1.5;stroke-linejoin:round;stroke-linecap:round;pointer-events:none}
.${CSS_PREFIX}_chartPoint{fill:var(--dsh-alias-label-primary);cursor:default}
.${CSS_PREFIX}_chartOthers{fill:#93a8b8}
.${CSS_PREFIX}_chartLegend{flex-wrap:wrap;gap:4px 10px;display:flex}
.${CSS_PREFIX}_chartLegendItem{font:inherit;font-size:11px;color:var(--dsw-alias-label-secondary);background:none;border:none;cursor:pointer;align-items:center;gap:5px;display:inline-flex;padding:2px 0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.${CSS_PREFIX}_chartLegendOff{color:var(--dsw-alias-label-dimmed);text-decoration:line-through}
.${CSS_PREFIX}_chartSwatch{width:10px;height:10px;border-radius:3px;flex:none}
@media (max-width:480px){
  .${CSS_PREFIX}_dashCards{grid-template-columns:repeat(2,minmax(0,1fr))}
}

.${CSS_PREFIX}_statBar{align-items:baseline;gap:16px;flex-wrap:wrap;display:flex}
.${CSS_PREFIX}_statItem{color:var(--dsw-alias-label-tertiary);font-size:12px}
.${CSS_PREFIX}_statValue{color:var(--dsw-alias-label-primary);font-weight:600;font-size:14px}
/* Filters: time range on its own full-width row; selects + actions below. */
.${CSS_PREFIX}_filters{flex-direction:column;gap:10px;display:flex}
.${CSS_PREFIX}_filterRow{align-items:flex-end;gap:10px;display:flex;min-width:0}
.${CSS_PREFIX}_filterField{flex-direction:column;gap:4px;min-width:0;flex:1 1 0;display:flex}
.${CSS_PREFIX}_filterFieldGrow{flex:1 1 auto;width:100%}
.${CSS_PREFIX}_rowTime{flex:1 1 auto;min-width:0;gap:6px}
.${CSS_PREFIX}_rowTime .${CSS_PREFIX}_input{flex:1 1 0;min-width:0}
.${CSS_PREFIX}_filterTilde{color:var(--dsw-alias-label-tertiary);flex:none}
.${CSS_PREFIX}_logTable{border:.5px solid var(--dsw-alias-border-l4);border-radius:10px;overflow:hidden;font-size:12px}
.${CSS_PREFIX}_logTable table{border-collapse:collapse;width:100%;table-layout:fixed}
.${CSS_PREFIX}_logTable th{color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:500;text-align:left;padding:6px 8px;border-bottom:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-interactive-bg-hover);overflow-wrap:anywhere}
.${CSS_PREFIX}_logTable td{color:var(--dsw-alias-label-primary);padding:7px 8px;border-bottom:.5px solid var(--dsw-alias-border-l4);vertical-align:top;overflow-wrap:anywhere}
.${CSS_PREFIX}_logTable tr:last-child td{border-bottom:none}
.${CSS_PREFIX}_logMono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px}
.${CSS_PREFIX}_logCost{font-variant-numeric:tabular-nums;font-size:11px}
.${CSS_PREFIX}_logSub{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:15px}
.${CSS_PREFIX}_pagination{align-items:center;gap:10px;justify-content:flex-end;padding:8px 4px 0;display:flex}
.${CSS_PREFIX}_pageInfo{color:var(--dsw-alias-label-tertiary);font-size:12px}

/* Capability tab: section titles, one-line rows, cards, preset details. */
.${CSS_PREFIX}_capSection{flex-direction:column;gap:8px;display:flex}
.${CSS_PREFIX}_capSectionTitle{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600;line-height:18px;text-transform:uppercase;letter-spacing:.04em}
.${CSS_PREFIX}_capRowLine{border:.5px solid var(--dsw-alias-border-l4);border-radius:10px;align-items:center;gap:8px;padding:6px 12px;display:flex;flex-wrap:nowrap;min-width:0}
.${CSS_PREFIX}_capHead{align-items:center;gap:8px;display:flex;flex-wrap:nowrap;min-width:0}
/* Model ids must render IN FULL on one line — never ellipsized, never wrapped.
   The auxiliary match hint sits below the id and may wrap; the summary area
   (modalities · reasoning · window) absorbs the squeeze and clamps at 2 lines. */
.${CSS_PREFIX}_capId{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;font-weight:700;color:var(--dsw-alias-label-primary);white-space:nowrap}
.${CSS_PREFIX}_capNameCell{flex-direction:column;gap:2px;align-items:flex-start;flex:0 1 auto;min-width:0;max-width:100%;display:flex}
.${CSS_PREFIX}_capMatch{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:14px}
.${CSS_PREFIX}_capActions{align-items:center;gap:6px;flex:none;display:flex;margin-left:auto}
.${CSS_PREFIX}_capRow{align-items:center;gap:8px;display:flex;flex-wrap:wrap}
.${CSS_PREFIX}_capLegend{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;width:70px;flex:none}
.${CSS_PREFIX}_capHint{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.${CSS_PREFIX}_capInvalid{color:var(--dsw-alias-state-error-primary);font-size:11px;line-height:16px}
.${CSS_PREFIX}_capSummary{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;flex:1 1 120px;min-width:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.${CSS_PREFIX}_capContext{width:180px;flex:none}
.${CSS_PREFIX}_kbName{width:220px;flex:none}

/* Preset layer: collapsed <details> + filter/refresh toolbar inside. */
.${CSS_PREFIX}_presetDetails{flex:1 1 auto;min-width:0;border:.5px solid var(--dsw-alias-border-l4);border-radius:10px;padding:6px 12px}
.${CSS_PREFIX}_presetDetails[open]{padding-bottom:10px}
.${CSS_PREFIX}_presetSummary{cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600;line-height:18px;list-style:none;display:flex;align-items:center;gap:6px;user-select:none}
.${CSS_PREFIX}_presetSummary::-webkit-details-marker{display:none}
.${CSS_PREFIX}_presetDetails[open] .${CSS_PREFIX}_presetChevron{transform:rotate(180deg)}
.${CSS_PREFIX}_presetChevron{color:var(--dsw-alias-label-tertiary);transition:transform .15s}
.${CSS_PREFIX}_presetBody{flex-direction:column;gap:8px;display:flex;margin-top:8px}
.${CSS_PREFIX}_presetToolbar{align-items:center;gap:8px;display:flex;min-width:0}
.${CSS_PREFIX}_presetFilter{height:28px;font-size:12px;flex:1 1 auto;min-width:0}
.${CSS_PREFIX}_presetToolbar button{flex:none}

/* Connection-tab accordion (v0.6.1): one collapsible item per panel. */
.${CSS_PREFIX}_panelItem{border:.5px solid var(--dsw-alias-border-l4);border-radius:10px;display:flex;flex-direction:column}
.${CSS_PREFIX}_panelItemOpen{border-color:var(--dsw-alias-brand-primary)}
.${CSS_PREFIX}_panelRowHead{align-items:center;gap:10px;padding:8px 12px;display:flex}
.${CSS_PREFIX}_panelChevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .15s}
.${CSS_PREFIX}_panelChevronOpen{transform:rotate(180deg)}
.${CSS_PREFIX}_panelBody{border-top:.5px solid var(--dsw-alias-border-l4);flex-direction:column;gap:12px;padding:12px;display:flex}
.${CSS_PREFIX}_panelMain{font:inherit;text-align:left;background:none;border:none;color:inherit;padding:0;flex-direction:column;gap:2px;min-width:0;flex:1 1 0;display:flex;cursor:pointer}
.${CSS_PREFIX}_panelMain:hover .${CSS_PREFIX}_keyName{color:var(--dsw-alias-brand-primary)}

/* Capability tab: per-panel platform groups. */
.${CSS_PREFIX}_capPanelGroup{flex-direction:column;gap:6px;display:flex}
.${CSS_PREFIX}_capPanelHead{align-items:baseline;gap:8px;flex-wrap:wrap;display:flex;margin-top:4px}
.${CSS_PREFIX}_capPanelName{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600}
/* Coverage indicator segments (R5): each source bucket filters the list. */
.${CSS_PREFIX}_capFilterSeg{font:inherit;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);background:none;border:none;cursor:pointer;padding:1px 5px;border-radius:5px}
.${CSS_PREFIX}_capFilterSeg:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.${CSS_PREFIX}_capFilterSegActive{color:var(--dsw-alias-brand-primary);font-weight:600;background:var(--dsw-alias-interactive-bg-hover)}
.${CSS_PREFIX}_capFilterClear{font:inherit;font-size:11px;line-height:16px;color:var(--dsw-alias-brand-primary);background:none;border:none;cursor:pointer;padding:1px 5px;text-decoration:underline}
`
