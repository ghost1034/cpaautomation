// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { FormattedInput } from './Form'
import { PHONE_FORMAT } from '@/components/firmcrm/lib/inputFormat'

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

function Harness() {
  const [value, setValue] = useState('')
  return <FormattedInput aria-label="Phone" value={value} onValueChange={setValue} format={PHONE_FORMAT} />
}

const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
/** Simulate the browser applying an edit: new DOM text and caret, then an input event. */
async function edit(input: HTMLInputElement, text: string, caret: number, inputType = 'insertText') {
  await act(async () => {
    setValue.call(input, text)
    input.setSelectionRange(caret, caret)
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType }))
  })
}

it('formats as the user types and keeps the caret after the edited digit', async () => {
  await act(async () => root.render(<Harness />))
  const input = host.querySelector('input')!
  input.focus()
  await edit(input, '5551234567', 10)
  expect(input.value).toBe('(555) 123-4567')
  expect(input.selectionStart).toBe(14)
  // Backspace just after the "-" removes the "3" before it rather than leaving the number unchanged.
  await edit(input, '(555) 1234567', 9, 'deleteContentBackward')
  expect(input.value).toBe('(555) 124-567')
  expect(input.selectionStart).toBe(8)
})
