/**
 * The 「模型」 tab of a panel detail page: the active key's callable models
 * with pricing; refreshing the list also syncs it into the panel's dsh route.
 * Every call carries the owning `panel` id.
 */

import { Button } from '@deepseek-ai/dsh-client-ui-primitives'

import { priceText, setupHintFor, type PriceView } from './format.js'
import type { Translator } from './locale.js'

export interface ModelRow {
  id: string
  price?: PriceView | null
}

export interface ModelsData {
  ok: boolean
  error?: string
  panel?: string
  models?: ModelRow[]
}

export interface ModelsTabProps {
  t: Translator
  models: ModelsData | null
  modelsBusy: boolean
  refreshModels: () => void
}

export function ModelsTab({ t, models, modelsBusy, refreshModels }: ModelsTabProps): JSX.Element {
  return (
    <div className="relay_card">
      <div className="relay_head">
        <div>
          <div className="relay_cardTitle">{t('modelsTitle')}</div>
          <p className="relay_metaLine">{t('modelsIntro')}</p>
        </div>
        <Button variant="ghost" size="sm" disabled={modelsBusy} onClick={refreshModels}>
          {modelsBusy ? t('refreshing') : t('refresh')}
        </Button>
      </div>
      {models === null ? <div className="relay_empty">{t('loading')}</div>
        : !models.ok ? <div className="relay_msg relay_msgErr">{setupHintFor(String(models.error ?? ''), t) ?? `${t('modelsLoadFail')}: ${String(models.error ?? '')}`}</div>
        : (
          <div className="relay_table">
            <div className="relay_tr relay_trHead">
              <span className="relay_td relay_tdId">{t('colModel')}</span>
              <span className="relay_td relay_tdPrice">{t('colPrice')}</span>
              <span className="relay_td relay_tdGroups">{t('colGroups')}</span>
            </div>
            {(models.models ?? []).map((m) => (
              <div key={m.id} className="relay_tr">
                <span className="relay_td relay_tdId">{m.id}</span>
                <span className="relay_td relay_tdPrice">{priceText(m.price ?? null, t)}</span>
                <span className="relay_td relay_tdGroups">
                  {m.price !== null && m.price !== undefined && m.price.groups !== undefined && m.price.groups.length ? m.price.groups.join('、') : t('priceNone')}
                </span>
              </div>
            ))}
          </div>
          )}
    </div>
  )
}
