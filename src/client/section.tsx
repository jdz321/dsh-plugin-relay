/**
 * The settings section, v0.6.0 shape: the main page has TWO tabs —
 * 「连接」 (the relay-panel list; click a row to open a panel's detail page)
 * and 「模型能力」 (the capability tab, whose platform section groups by
 * panel). The panel detail page carries the four per-panel tabs (keys /
 * models / dashboard / logs) — see panel-detail.tsx.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

import { apiGet } from './api.js'
import { CapabilitiesView, type CapData } from './capabilities.js'
import { PanelDetail } from './panel-detail.js'
import { PanelsTab, type PanelSummary } from './panels-tab.js'
import type { Translator } from './locale.js'

export interface ScopeSnapshot {
  value?: Record<string, unknown>
  status?: string
  revision?: number
  writable?: boolean
}

export interface SettingsScope {
  subscribe(fn: () => void): () => void
  getSnapshot(): ScopeSnapshot
  set(field: string, value: unknown): Promise<void>
}

export interface SectionEnv {
  scope: SettingsScope
  t: Translator
}

type TabId = 'connection' | 'capabilities'

type Message = { ok: boolean, text: string } | null

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** The settings section component mounted by the entry. */
export function RelaySection(props: SectionEnv): JSX.Element {
  const { scope, t } = props
  const snapshot = useSyncExternalStore((fn) => scope.subscribe(fn), () => scope.getSnapshot())

  const [tab, setTab] = useState<TabId>('connection')
  const [message, setMessage] = useState<Message>(null)
  const [panels, setPanels] = useState<PanelSummary[] | null>(null)
  const [panelsBusy, setPanelsBusy] = useState(false)
  const [openPanelId, setOpenPanelId] = useState<string | null>(null)
  const [caps, setCaps] = useState<CapData | null>(null)

  const refreshPanels = useCallback((): void => {
    setPanelsBusy(true)
    apiGet('/api/relay/panels')
      .then((body) => setPanels((body.panels ?? null) as PanelSummary[] | null))
      .catch((err) => {
        setPanels(null)
        setMessage({ ok: false, text: t('actionFail')(errText(err)) })
      })
      .finally(() => setPanelsBusy(false))
  }, [t])
  useEffect(() => {
    refreshPanels()
  }, [refreshPanels, snapshot.revision])

  const refreshCaps = useCallback((): void => {
    apiGet('/api/relay/capabilities')
      .then((body) => setCaps(body as unknown as CapData))
      .catch((err) => setCaps({ ok: false, error: errText(err) }))
  }, [])
  // Re-pull when the namespace changed (key switches / capability saves) and
  // when returning from a panel detail page (a key switch may have created
  // that panel's route) — a stale "not configured" view must not linger.
  useEffect(() => {
    refreshCaps()
  }, [refreshCaps, snapshot.revision, openPanelId])

  const openPanel = openPanelId === null ? null : (panels ?? []).find((panel) => panel.id === openPanelId) ?? null
  // A panel just deleted from the detail page closes the detail view.
  useEffect(() => {
    if (openPanelId !== null && panels !== null && !panels.some((panel) => panel.id === openPanelId)) {
      setOpenPanelId(null)
    }
  }, [openPanelId, panels])

  const totalModels = (panels ?? []).reduce((sum, panel) => sum + panel.modelCount, 0)

  const tabs: Array<{ id: TabId, label: string }> = [
    { id: 'connection', label: t('tabConnection') },
    { id: 'capabilities', label: t('tabCapabilities') },
  ]

  return (
    <div className="relay_section">
      <h3 className="relay_title">{t('title')}</h3>
      <p className="relay_intro">{t('intro')}</p>
      {panels !== null && (
        <p className="relay_metaLine">
          {t('panelsStatusLine')(panels.length, totalModels)}
        </p>
      )}
      {message !== null && <div className={message.ok ? 'relay_msg relay_msgOk' : 'relay_msg relay_msgErr'} role="status" aria-live="polite">{message.text}</div>}
      {snapshot.writable === false && <p className="relay_metaLine">{t('readOnlyHint')}</p>}

      {openPanel !== null ? (
        <PanelDetail
          t={t}
          panel={openPanel}
          readOnly={snapshot.writable === false}
          onBack={() => {
            setOpenPanelId(null)
            refreshPanels()
          }}
          onMessage={setMessage}
        />
      ) : (
        <>
          <div className="relay_tabs" role="tablist">
            {tabs.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={tab === entry.id}
                className={tab === entry.id ? 'relay_tab relay_tabActive' : 'relay_tab'}
                onClick={() => setTab(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>

          {tab === 'connection' && (
            <PanelsTab
              t={t}
              panels={panels}
              readOnly={snapshot.writable === false}
              busy={panelsBusy}
              refreshPanels={refreshPanels}
              onOpen={setOpenPanelId}
              onMessage={setMessage}
            />
          )}

          {tab === 'capabilities' && (
            <CapabilitiesView
              t={t}
              caps={caps}
              refreshCaps={refreshCaps}
              onMessage={setMessage}
            />
          )}
        </>
      )}
    </div>
  )
}
