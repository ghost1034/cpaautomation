import { describe, expect, it } from 'vitest'
import {
  PHONE_FORMAT, ZIP_FORMAT, applyFormat, formatDecimalInput, formatEmailList, formatHexColor, formatPhone, formatPostal, formatRouting,
  formatSwift, formatZip, isValidRouting,
} from './inputFormat'
import { tidyAmount } from './billingMath'
import { PAYMENT_TERMS, withCurrent } from './options'

describe('formatters', () => {
  it('formats US phone numbers progressively', () => {
    expect(formatPhone('')).toBe('')
    expect(formatPhone('5')).toBe('(5')
    expect(formatPhone('5551')).toBe('(555) 1')
    expect(formatPhone('5551234567')).toBe('(555) 123-4567')
    expect(formatPhone('555.123.4567 ext 89')).toBe('(555) 123-4567 x89')
    expect(formatPhone('15551234567')).toBe('+1 (555) 123-4567')
    expect(formatPhone('+1 555 123 4567')).toBe('+1 (555) 123-4567')
    expect(formatPhone('+44 20 7946 0958')).toBe('+44 20 7946 0958')
  })

  it('is idempotent', () => {
    for (const v of ['(555) 123-4567', '+1 (555) 123-4567 x12']) expect(formatPhone(v)).toBe(v)
    expect(formatZip('12345-6789')).toBe('12345-6789')
  })

  it('formats codes', () => {
    expect(formatZip('123456789')).toBe('12345-6789')
    expect(formatZip('1234a')).toBe('1234')
    expect(formatPostal('k1a  0b6')).toBe('K1A 0B6')
    expect(formatRouting('021-000-0211')).toBe('021000021')
    expect(formatSwift('chas us 33xxx')).toBe('CHASUS33XXX')
    expect(formatHexColor('1683db')).toBe('#1683DB')
    expect(formatHexColor('')).toBe('')
    expect(formatDecimalInput('$1,250.505')).toBe('1250.50')
    expect(formatDecimalInput('1.2.3')).toBe('1.23')
    expect(formatEmailList(' a@x.com;b@y.com  c@z.com,')).toBe('a@x.com, b@y.com, c@z.com')
    expect(tidyAmount('1250.5')).toBe('1,250.50')
    expect(tidyAmount('abc')).toBe('abc')
  })

  it('checks ABA routing numbers', () => {
    expect(isValidRouting('021000021')).toBe(true)
    expect(isValidRouting('021000022')).toBe(false)
    expect(isValidRouting('12345')).toBe(false)
  })

  it('keeps unknown values selectable', () => {
    expect(withCurrent(PAYMENT_TERMS, 30)).toBe(PAYMENT_TERMS)
    expect(withCurrent(PAYMENT_TERMS, 20)[PAYMENT_TERMS.length]).toEqual({ value: 20, label: '20' })
  })
})

describe('applyFormat caret', () => {
  it('keeps the caret after the typed digit when separators are inserted', () => {
    // "(555) 12" + typing "3" at the end
    expect(applyFormat(PHONE_FORMAT, '(555) 12', '(555) 123', 9, null)).toEqual({ value: '(555) 123', caret: 9 })
    // typing "4" right after "(555" turns "(5551" into "(555) 1"
    expect(applyFormat(PHONE_FORMAT, '(555', '(5551', 5, null)).toEqual({ value: '(555) 1', caret: 7 })
    // inserting a digit in the middle keeps the caret right after it
    expect(applyFormat(PHONE_FORMAT, '(555) 123-4567', '(5555) 123-4567', 5, null)).toEqual({ value: '(555) 512-3456 x7', caret: 7 })
  })

  it('deletes the digit before a separator on backspace', () => {
    // caret after "-" in "(555) 123-4567"; backspace removes "-" in the DOM, then "3" is removed instead
    expect(applyFormat(PHONE_FORMAT, '(555) 123-4567', '(555) 1234567', 9, 'backward')).toEqual({ value: '(555) 124-567', caret: 8 })
    expect(applyFormat(ZIP_FORMAT, '12345-6789', '123456789', 5, 'backward')).toEqual({ value: '12346-789', caret: 4 })
  })
})
