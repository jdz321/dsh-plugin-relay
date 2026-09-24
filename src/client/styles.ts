/**
 * Stylesheet of the browser face, injected once per page load. Every class
 * carries the `relay_` prefix — plain CSS, no modules, no collision with the
 * host or sibling plugins. Colors come from the shell's design tokens.
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
.${CSS_PREFIX}_button{box-sizing:border-box;height:32px;font:inherit;cursor:pointer;border:none;border-radius:16px;justify-content:center;align-items:center;gap:4px;padding:0 14px;font-size:13px;line-height:20px;display:inline-flex;white-space:nowrap;flex:none}
.${CSS_PREFIX}_buttonPrimary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
.${CSS_PREFIX}_buttonPrimary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.${CSS_PREFIX}_buttonSecondary{border:.5px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-primary);background:0 0}
.${CSS_PREFIX}_buttonSecondary:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.${CSS_PREFIX}_buttonSm{height:26px;padding:0 10px;font-size:12px;line-height:16px;border-radius:13px;flex:none}
.${CSS_PREFIX}_button:disabled{opacity:.4;cursor:default}
.${CSS_PREFIX}_keyRow{border:.5px solid var(--dsw-alias-border-l4);border-radius:10px;align-items:center;gap:10px;padding:8px 10px;display:flex}
.${CSS_PREFIX}_keyMain{flex-direction:column;gap:2px;min-width:0;flex:1 1 0;display:flex}
.${CSS_PREFIX}_keyName{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:20px}
.${CSS_PREFIX}_keyMeta{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.${CSS_PREFIX}_tag{border:.5px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary);border-radius:4px;flex:none;padding:1px 6px;font-size:11px;line-height:16px}
.${CSS_PREFIX}_tagOk{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
.${CSS_PREFIX}_tagBad{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
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

.${CSS_PREFIX}_capCard{border:.5px solid var(--dsw-alias-border-l4);border-radius:10px;flex-direction:column;gap:10px;padding:10px 12px;display:flex}
.${CSS_PREFIX}_capCardDirty{border-color:var(--dsw-alias-brand-primary)}
.${CSS_PREFIX}_capHead{align-items:center;gap:8px;display:flex}
.${CSS_PREFIX}_capId{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;font-weight:700;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere;flex:1 1 0}
.${CSS_PREFIX}_capVendor{border:.5px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary);border-radius:4px;flex:none;padding:1px 6px;font-size:11px;line-height:16px}
.${CSS_PREFIX}_capActions{align-items:center;gap:6px;flex:none;display:flex}
.${CSS_PREFIX}_capRow{align-items:center;gap:8px;display:flex}
.${CSS_PREFIX}_capLegend{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;width:70px;flex:none}
.${CSS_PREFIX}_chip{font:inherit;font-size:12px;line-height:18px;cursor:pointer;border:.5px solid var(--dsw-alias-border-l3);background:0 0;color:var(--dsw-alias-label-secondary);border-radius:13px;padding:2px 10px}
.${CSS_PREFIX}_chip:hover{background:var(--dsw-alias-interactive-bg-hover)}
.${CSS_PREFIX}_chipOn{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground)}
.${CSS_PREFIX}_chipOn:hover{background:var(--dsw-alias-brand-primary)}
.${CSS_PREFIX}_switch{position:relative;width:36px;height:20px;border-radius:10px;background:var(--dsw-alias-border-l3);border:none;cursor:pointer;flex:none;transition:background .15s}
.${CSS_PREFIX}_switchOn{background:var(--dsw-alias-brand-primary)}
.${CSS_PREFIX}_switchKnob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:8px;background:var(--dsw-alias-label-primary-foreground);transition:left .15s}
.${CSS_PREFIX}_switchOn .${CSS_PREFIX}_switchKnob{left:18px}
.${CSS_PREFIX}_capHint{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.${CSS_PREFIX}_capBadge{border:.5px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-tertiary);border-radius:4px;flex:none;padding:1px 6px;font-size:11px;line-height:16px;overflow-wrap:anywhere}
.${CSS_PREFIX}_capBadgeOverride{color:var(--dsw-alias-state-warning-primary,#c47f17);border-color:var(--dsw-alias-state-warning-primary,#c47f17)}
.${CSS_PREFIX}_capBadgeCatalog{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
.${CSS_PREFIX}_capBadgeApprox{color:var(--dsw-alias-label-secondary);border-color:var(--dsw-alias-brand-primary)}
.${CSS_PREFIX}_capSection{flex-direction:column;gap:8px;display:flex}
.${CSS_PREFIX}_capSectionTitle{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600;line-height:18px;text-transform:uppercase;letter-spacing:.04em}
.${CSS_PREFIX}_capContext{width:140px;flex:none}
.${CSS_PREFIX}_capFieldRow{align-items:center;gap:8px;flex-wrap:wrap;display:flex}
.${CSS_PREFIX}_kbName{width:200px;flex:none}

.${CSS_PREFIX}_form{border:.5px dashed var(--dsw-alias-border-l3);border-radius:10px;flex-direction:column;gap:10px;padding:10px 12px;display:flex}
.${CSS_PREFIX}_formGrid{gap:10px 16px;display:grid;grid-template-columns:1fr 1fr}
.${CSS_PREFIX}_formSpan2{grid-column:span 2}
.${CSS_PREFIX}_checkRow{align-items:center;gap:6px;display:flex}
.${CSS_PREFIX}_checkbox{accent-color:var(--dsw-alias-brand-primary);width:14px;height:14px;margin:0}
.${CSS_PREFIX}_radioRow{align-items:center;gap:12px;flex-wrap:wrap;display:flex}
.${CSS_PREFIX}_radio{accent-color:var(--dsw-alias-brand-primary);width:13px;height:13px;margin:0}
.${CSS_PREFIX}_select{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);width:100%;height:32px;font:inherit;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 8px;font-size:13px}
.${CSS_PREFIX}_selectSm{height:28px;font-size:12px;width:auto}
.${CSS_PREFIX}_select:focus{border-color:var(--dsw-alias-brand-primary);outline:none}
.${CSS_PREFIX}_formActions{justify-content:flex-end;gap:8px;align-items:center;display:flex}

.${CSS_PREFIX}_dashCards{gap:10px;display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
.${CSS_PREFIX}_dashCard{border:.5px solid var(--dsw-alias-border-l4);border-radius:10px;flex-direction:column;gap:4px;padding:10px 12px;display:flex}
.${CSS_PREFIX}_dashLabel{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.${CSS_PREFIX}_dashValue{color:var(--dsw-alias-label-primary);font-size:18px;font-weight:600;line-height:26px;overflow-wrap:anywhere}
.${CSS_PREFIX}_dashSub{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.${CSS_PREFIX}_dashChart{border:.5px solid var(--dsw-alias-border-l4);border-radius:10px;flex-direction:column;gap:8px;padding:10px 12px;display:flex}
.${CSS_PREFIX}_dashChartHead{align-items:center;justify-content:space-between;gap:8px;display:flex}
.${CSS_PREFIX}_chart{width:100%;font-size:11px}
.${CSS_PREFIX}_chart .recharts-text{fill:var(--dsw-alias-label-tertiary);font-size:10px}
.${CSS_PREFIX}_chart .recharts-default-legend{font-size:11px}

.${CSS_PREFIX}_statBar{align-items:baseline;gap:16px;flex-wrap:wrap;display:flex}
.${CSS_PREFIX}_statItem{color:var(--dsw-alias-label-tertiary);font-size:12px}
.${CSS_PREFIX}_statValue{color:var(--dsw-alias-label-primary);font-weight:600;font-size:14px}
.${CSS_PREFIX}_filters{align-items:flex-end;gap:10px;flex-wrap:wrap;display:flex}
.${CSS_PREFIX}_filterField{flex-direction:column;gap:4px;min-width:140px;flex:1 1 140px;display:flex}
.${CSS_PREFIX}_filterFieldWide{flex:2 1 240px}
.${CSS_PREFIX}_logTable{border:.5px solid var(--dsw-alias-border-l4);border-radius:10px;overflow:hidden;font-size:12px}
.${CSS_PREFIX}_logTable table{border-collapse:collapse;width:100%;table-layout:fixed}
.${CSS_PREFIX}_logTable th{color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:500;text-align:left;padding:6px 8px;border-bottom:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-interactive-bg-hover);overflow-wrap:anywhere}
.${CSS_PREFIX}_logTable td{color:var(--dsw-alias-label-primary);padding:7px 8px;border-bottom:.5px solid var(--dsw-alias-border-l4);vertical-align:top;overflow-wrap:anywhere}
.${CSS_PREFIX}_logTable tr:last-child td{border-bottom:none}
.${CSS_PREFIX}_logMono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px}
.${CSS_PREFIX}_logSub{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:15px}
.${CSS_PREFIX}_pagination{align-items:center;gap:10px;justify-content:flex-end;padding:8px 4px 0;display:flex}
.${CSS_PREFIX}_pageInfo{color:var(--dsw-alias-label-tertiary);font-size:12px}
`
