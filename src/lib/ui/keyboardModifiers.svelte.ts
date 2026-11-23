export const keyboardModifiers = $state({ shift: false });

export function updateKeyboardModifiers(event: KeyboardEvent | MouseEvent): void {
  keyboardModifiers.shift = event.shiftKey;
}
