// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TemplateField, insertAt } from './TemplateField'
import { SAMPLE_VALUES, findUnknownPlaceholders, invoicePlaceholderValues, isRenderable, renderTemplatePreview } from './templatePlaceholders'

let host: HTMLDivElement
let root: Root
const frames: FrameRequestCallback[] = []
// Like a browser: frame callbacks run after React has committed the update.
const click = async (button: HTMLButtonElement) => {
  await act(async () => button.click())
  await act(async () => { frames.splice(0).forEach((cb) => cb(0)) })
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

function Harness({ initial, disabled }: { initial: string; disabled?: boolean }) {
  const [value, setValue] = useState(initial)
  return <TemplateField label="Terms" value={value} onChange={setValue} values={SAMPLE_VALUES} disabled={disabled} />
}
const input = () => host.querySelector('input')!
const chip = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="Insert ${label}"]`)!

it('renders known placeholders, keeps unknown and unset ones, and honours escaped braces', () => {
  const all = '{invoice_number} {customer_name} {total} {issue_date} {due_date} {issuer_name}'
  expect(renderTemplatePreview(all, SAMPLE_VALUES)).toBe('1042 Acme Holdings $4,250.00 03/01/2026 03/31/2026 Your firm')
  expect(renderTemplatePreview('By {due_date} {foo}', {})).toBe('By {due_date} {foo}')
  expect(renderTemplatePreview('{{due_date}} {due_date}', SAMPLE_VALUES)).toBe('{due_date} 03/31/2026')
})

it('treats stray braces like the backend: nothing is substituted', () => {
  for (const text of ['Pay by {due_date} {', '{} {due_date}', '{0} {due_date}', 'oops }']) {
    expect(isRenderable(text)).toBe(false)
    expect(renderTemplatePreview(text, SAMPLE_VALUES)).toBe(text)
  }
  expect(isRenderable('Pay {{now}} by {due_date}')).toBe(true)
})

it('lists unknown placeholders once', () => {
  expect(findUnknownPlaceholders('{duedate} {total} {duedate} {Total}')).toEqual(['duedate', 'Total'])
  expect(findUnknownPlaceholders('{{duedate}}')).toEqual([])
})

it('projects draft dates the way issuing does', () => {
  const v = invoicePlaceholderValues({ number: null, billed_to_name: 'Acme', issue_date: '2026-03-01', due_date: '' }, '$1.00', 'Firm', 30)
  expect(v).toMatchObject({ invoice_number: undefined, customer_name: 'Acme', total: '$1.00', issue_date: '03/01/2026', due_date: '03/31/2026', issuer_name: 'Firm' })
})

it('inserts over the selection, appends when never focused, and respects maxLength', () => {
  expect(insertAt('Pay by X.', '{due_date}', 7, 8)).toEqual({ value: 'Pay by {due_date}.', caret: 17 })
  expect(insertAt('Pay by ', '{due_date}', null, null)).toEqual({ value: 'Pay by {due_date}', caret: 17 })
  expect(insertAt('12345', '{total}', null, null, 10)).toBeNull()
})

it('inserts a placeholder at the caret from a chip and previews the result', async () => {
  await act(async () => root.render(<Harness initial="" />))
  await click(chip('Due date'))
  expect(input().value).toBe('{due_date}')
  await act(async () => { input().focus(); input().setSelectionRange(0, 0) })
  await click(chip('Customer name'))
  expect(input().value).toBe('{customer_name}{due_date}')
  expect(input().selectionStart).toBe('{customer_name}'.length)
  expect(host.textContent).toContain('Preview: Acme Holdings03/31/2026')
})

it('warns about unknown placeholders and stray braces, but not valid text', async () => {
  await act(async () => root.render(<Harness initial="Pay by {due_date}" />))
  expect(host.textContent).not.toContain('recognized')
  await act(async () => root.render(<Harness key="b" initial="Pay by {duedate}" />))
  expect(host.textContent).toContain('{duedate} isn’t a recognized field')
  await act(async () => root.render(<Harness key="c" initial="Pay by {due_date" />))
  expect(host.textContent).toContain('Unmatched')
  expect(host.textContent).not.toContain('Preview:')
})

it('hides the chips when disabled', async () => {
  await act(async () => root.render(<Harness initial="{due_date}" disabled />))
  expect(host.querySelector('[role="group"]')).toBeNull()
  expect(input().disabled).toBe(true)
})
