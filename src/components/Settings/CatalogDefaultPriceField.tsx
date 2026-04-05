import { useEffect, useState, type ChangeEvent } from 'react'
import { formatMoney } from '../../lib/formatMoney'

type Props = {
  id?: string
  value: number
  onChange: (value: number) => void
  currencyCode: string
  className?: string
  required?: boolean
}

/**
 * Preço do catálogo: digitação por centavos (como CreateOpportunityModal) + formatação Intl da moeda da empresa.
 */
export function CatalogDefaultPriceField({
  value,
  onChange,
  currencyCode,
  className,
  required,
  id,
}: Props) {
  const code = (currencyCode || 'BRL').trim().toUpperCase()
  const [display, setDisplay] = useState(() => formatMoney(value, code))

  useEffect(() => {
    setDisplay(formatMoney(value, code))
  }, [code])

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const numbersOnly = e.target.value.replace(/\D/g, '')
    if (!numbersOnly) {
      onChange(0)
      setDisplay(formatMoney(0, code))
      return
    }
    const numericValue = parseInt(numbersOnly, 10) / 100
    onChange(numericValue)
    setDisplay(formatMoney(numericValue, code))
  }

  return (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      className={className}
      value={display}
      onChange={handleChange}
      required={required}
    />
  )
}
