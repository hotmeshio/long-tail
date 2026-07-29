import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { removeFromActiveEditable } from '../editable-repair';

let input: HTMLInputElement;

beforeEach(() => {
  input = document.createElement('input');
  input.type = 'text';
  document.body.appendChild(input);
  input.focus();
});

afterEach(() => {
  input.remove();
});

function setCaret(pos: number) {
  input.setSelectionRange(pos, pos);
}

describe('removeFromActiveEditable', () => {
  it('removes the count immediately before the cursor', () => {
    input.value = 'hello1';
    setCaret(6);
    removeFromActiveEditable(1);
    expect(input.value).toBe('hello');
    expect(input.selectionStart).toBe(5);
  });

  it('repairs mid-text leaks at the cursor, keeping the tail', () => {
    input.value = 'ab1cd';
    setCaret(3); // cursor right after the leaked '1'
    removeFromActiveEditable(1);
    expect(input.value).toBe('abcd');
    expect(input.selectionStart).toBe(2);
  });

  it('clamps at the start of the value', () => {
    input.value = 'x';
    setCaret(1);
    removeFromActiveEditable(5);
    expect(input.value).toBe('');
  });

  it('fires an input event so controlled inputs observe the repair', () => {
    input.value = 'a1';
    setCaret(2);
    let fired = false;
    input.addEventListener('input', () => { fired = true; });
    removeFromActiveEditable(1);
    expect(fired).toBe(true);
  });

  it('leaves the page alone when nothing editable is focused', () => {
    input.blur();
    input.value = 'keep';
    removeFromActiveEditable(2);
    expect(input.value).toBe('keep');
  });
});

describe('removeFromActiveEditable — code-length strips', () => {
  it('strips a full scan code the wedge accumulated in the input', () => {
    const code = '10:4:SN-TEST-8';
    input.value = `10:4:SN-TEST-8${code}`; // typed value + scanned characters
    setCaret(input.value.length);
    removeFromActiveEditable(code.length);
    expect(input.value).toBe('10:4:SN-TEST-8');
    expect(input.selectionStart).toBe('10:4:SN-TEST-8'.length);
  });
});
