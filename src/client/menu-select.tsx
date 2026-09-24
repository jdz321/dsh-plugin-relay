/**
 * MenuSelect: the plugin-wide dropdown selector, built the way the official
 * settings pages build theirs (packages/client/locale LanguageRow — anchor
 * button holding the current value + chevron, primitives `Menu` portaled to
 * document.body so the settings dialog never clips it). Every `<select>` in
 * the plugin face goes through this one wrapper.
 */

import { useState } from 'react'

import { IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'

export interface MenuSelectItem {
  id: string
  label: string
}

export interface MenuSelectProps {
  /** Current value; '' means the placeholder (all/empty) option is selected. */
  value: string
  /** Label of the leading empty option (field-specific “全部…” wording). */
  placeholder: string
  items: readonly MenuSelectItem[]
  onSelect: (id: string) => void
  disabled?: boolean
  className?: string
}

export function MenuSelect({ value, placeholder, items, onSelect, disabled = false, className = '' }: MenuSelectProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const current = items.find((item) => item.id === value)
  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      align="start"
      portal
      items={[{ id: '', label: placeholder }, ...items]}
      selectedId={value}
      onSelect={(id) => {
        setOpen(false)
        onSelect(id)
      }}
      anchor={(
        <button
          type="button"
          className={`relay_selectAnchor ${className}`.trim()}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => { setOpen((v) => !v) }}
        >
          <span className={current ? 'relay_selectAnchorValue' : 'relay_selectAnchorValue relay_selectAnchorPlaceholder'}>{current ? current.label : placeholder}</span>
          <IconChevronDownOutline14 className="relay_selectChevron" />
        </button>
      )}
    />
  )
}
