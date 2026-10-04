import { describe, expect, it } from 'vitest'
import { formatAmount, formatCents, invoiceTotalCents, lineAmountCents, parseHundredths } from './billingMath'

describe('billingMath', () => {
  it('parses amounts with at most two decimals', () => {
    expect(parseHundredths('25,000')).toBe(2500000)
    expect(parseHundredths('$1,250.5')).toBe(125050)
    expect(parseHundredths('0.05')).toBe(5)
    expect(parseHundredths('1.005')).toBeNull()
    expect(parseHundredths('-1')).toBeNull()
    expect(parseHundredths('abc')).toBeNull()
  })

  it('rounds line amounts half-up to cents like the backend', () => {
    expect(lineAmountCents('150.25', '2.5')).toBe(37563) // 375.625 → 375.63
    expect(lineAmountCents('0.01', '0.5')).toBe(1)
    expect(lineAmountCents('25000', '1')).toBe(2500000)
    expect(lineAmountCents('10', 'x')).toBeNull()
  })

  it('totals lines and formats like the PDF', () => {
    const total = invoiceTotalCents([{ unit_cost: '25000.00', quantity: '1' }, { unit_cost: '18000', quantity: 1 }])
    expect(formatCents(total)).toBe('$43,000.00')
    expect(formatCents(123456789, 'EUR')).toBe('EUR 1,234,567.89')
    expect(formatAmount('43000.00')).toBe('$43,000.00')
    expect(formatAmount(null)).toBe('—')
  })
})
