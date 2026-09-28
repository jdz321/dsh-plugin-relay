/**
 * The EXPANDED body of one connection-tab accordion panel (v0.6.1) — the
 * former panel detail page without its back button. Header: the status line
 * (models synced · active key) plus 测试连接 / 删除 outline buttons; below,
 * the four per-panel tabs — API Keys / 模型 / 数据看板 / 使用日志 — scoped to
 * one panel (every request carries the panel id). The component unmounts on
 * collapse, so tab and draft state reset when the accordion moves on.
 */

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'

import { apiGet, apiPost } from './api.js'
import { DashboardTab } from './dashboard.js'
import { endOfDaySeconds } from './format.js'
import { KeysTab, type KeyForm, type KeysData } from './keys.js'
import { LogsTab } from './logs.js'
import { ModelsTab, type ModelsData } from './models-tab.js'
import { testResultMessage, type PanelSummary } from './panels-tab.js'
import type { Translator } from './locale.js'

type SubTab = 'keys' | 'models' | 'dashboard' | 'logs'

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export interface PanelBodyProps {
  t: Translator
  panel: PanelSummary
  readOnly: boolean
  onMessage: (message: { ok: boolean, text: string } | null) => void
  onDelete: () => void
}

export function PanelBody({ t, panel, readOnly, onMessage, onDelete }: PanelBodyProps): JSX.Element {
  const [subTab, setSubTab] = useState<SubTab>('keys')
  const [keys, setKeys] = useState<KeysData | null>(null)
  const [keysBusy, setKeysBusy] = useState(false)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [models, setModels] = useState<ModelsData | null>(null)
  const [modelsBusy, setModelsBusy] = useState(false)
  const [testBusy, setTestBusy] = useState(false)

  const refreshKeys = useCallback((): void => {
    setKeysBusy(true)
    apiGet(`/api/relay/keys?panel=${encodeURIComponent(panel.id)}`)
      .then((body) => setKeys(body as unknown as KeysData))
      .catch((err) => setKeys({ ok: false, error: errText(err) }))
      .finally(() => setKeysBusy(false))
  }, [panel.id])
  useEffect(() => {
    refreshKeys()
  }, [refreshKeys])

  const refreshModels = useCallback((): void => {
    setModelsBusy(true)
    apiGet(`/api/relay/models?panel=${encodeURIComponent(panel.id)}`)
      .then((body) => setModels(body as unknown as ModelsData))
      .catch((err) => setModels({ ok: false, error: errText(err) }))
      .finally(() => setModelsBusy(false))
  }, [panel.id])
  useEffect(() => {
    refreshModels()
  }, [refreshModels])

  const refreshAll = useCallback((): void => {
    refreshKeys()
    refreshModels()
  }, [refreshKeys, refreshModels])

  /** Create/edit submission: runs the request, refreshes, and reports. */
  const submitKeyForm = async (form: KeyForm): Promise<{ ok: boolean, error?: string }> => {
    const expiredTime = form.expireNever ? -1 : endOfDaySeconds(form.expireDate)
    const payload = {
      panel: panel.id,
      name: form.name.trim(),
      group: form.group.trim(),
      unlimitedQuota: form.unlimitedQuota,
      remainQuota: form.unlimitedQuota ? 0 : Number(form.remainQuota),
      expiredTime,
    }
    let ok = false
    let error = ''
    try {
      if (form.mode === 'create') {
        const body = await apiPost('/api/relay/keys-create', { ...payload, setAsActive: form.setAsActive })
        if (body.ok) {
          ok = true
          const name = String((body.key as Record<string, unknown>)?.name ?? payload.name)
          const warn = Array.isArray(body.warnings) && body.warnings.length ? `\n${(body.warnings as string[]).join('\n')}` : ''
          onMessage({ ok: true, text: (form.setAsActive && body.switched === true ? t('keyCreatedSwitched')(name) : t('keyCreated')(name)) + warn })
        } else {
          error = String(body.error ?? '?')
        }
      } else {
        const body = await apiPost('/api/relay/keys-update', { id: form.id, ...payload, enabled: form.enabled })
        if (body.ok) {
          ok = true
          onMessage({ ok: true, text: t('keyUpdated') })
        } else {
          error = String(body.error ?? '?')
        }
      }
    } catch (err) {
      error = errText(err)
    }
    refreshAll()
    return ok ? { ok } : { ok: false, error }
  }

  const testConnection = async (): Promise<void> => {
    setTestBusy(true)
    onMessage(null)
    try {
      const body = await apiPost('/api/relay/connection-test', { panel: panel.id })
      onMessage(testResultMessage(body, t))
    } catch (err) {
      onMessage({ ok: false, text: t('actionFail')(errText(err)) })
    } finally {
      setTestBusy(false)
    }
  }

  const tabs: Array<{ id: SubTab, label: string }> = [
    { id: 'keys', label: t('tabKeys') },
    { id: 'models', label: t('tabModels') },
    { id: 'dashboard', label: t('tabDashboard') },
    { id: 'logs', label: t('tabLogs') },
  ]
  const keyNames = (keys?.ok ? keys.keys ?? [] : []).map((key) => key.name)

  return (
    <div className="relay_tabPane">
      <div className="relay_head">
        <span className="relay_metaLine">{t('statusLine')(panel.modelCount, panel.selectedKeyName || t('notSet'))}</span>
        <span className="relay_formActions">
          <Button variant="outline" size="sm" disabled={testBusy} onClick={() => { void testConnection() }}>
            {testBusy ? t('testing') : t('testConnection')}
          </Button>
          <Button variant="outline" size="sm" disabled={readOnly} onClick={onDelete}>
            {t('keyDelete')}
          </Button>
        </span>
      </div>

      <div className="relay_tabs" role="tablist">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={subTab === entry.id}
            className={subTab === entry.id ? 'relay_tab relay_tabActive' : 'relay_tab'}
            onClick={() => setSubTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {subTab === 'keys' && (
        <KeysTab
          t={t}
          panel={panel.id}
          readOnly={readOnly}
          keys={keys}
          keysBusy={keysBusy}
          openKey={openKey}
          setOpenKey={setOpenKey}
          refreshKeys={refreshKeys}
          submitKeyForm={submitKeyForm}
          onMessage={onMessage}
          refreshAll={refreshAll}
        />
      )}
      {subTab === 'models' && (
        <ModelsTab t={t} models={models} modelsBusy={modelsBusy} refreshModels={refreshModels} />
      )}
      {subTab === 'dashboard' && <DashboardTab t={t} panel={panel.id} />}
      {subTab === 'logs' && <LogsTab t={t} panel={panel.id} keyNames={keyNames} />}
    </div>
  )
}
