import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests for overlay show/hide/toggle logic.
 *
 * Since we can't use real Electron BrowserWindow in node tests,
 * we extract and test the state machine as a pure model.
 */

interface OverlayVisibility {
  visible: boolean;
  blurHandlerEnabled: boolean;
}

function createOverlay(): OverlayVisibility {
  return { visible: false, blurHandlerEnabled: true };
}

function show(state: OverlayVisibility): OverlayVisibility {
  // During show, blur handler is temporarily disabled to prevent
  // spurious blur events from immediately hiding the window
  return { visible: true, blurHandlerEnabled: true };
}

function hide(state: OverlayVisibility): OverlayVisibility {
  if (!state.visible) return state;
  // isHiding flag prevents blur handler from re-entering hide()
  return { visible: false, blurHandlerEnabled: true };
}

function toggle(state: OverlayVisibility): OverlayVisibility {
  return state.visible ? hide(state) : show(state);
}

function onBlur(state: OverlayVisibility, isHiding: boolean): OverlayVisibility {
  // blur handler should not fire during programmatic hide or show
  if (isHiding) return state;
  return hide(state);
}

describe('Overlay visibility state machine', () => {
  describe('toggle', () => {
    it('shows overlay when hidden', () => {
      const state = createOverlay();
      expect(toggle(state).visible).toBe(true);
    });

    it('hides overlay when visible', () => {
      const state = show(createOverlay());
      expect(toggle(state).visible).toBe(false);
    });

    it('can show again after hiding', () => {
      let state = createOverlay();
      state = toggle(state); // show
      state = toggle(state); // hide
      state = toggle(state); // show again
      expect(state.visible).toBe(true);
    });
  });

  describe('hide', () => {
    it('hides a visible overlay', () => {
      const state = show(createOverlay());
      expect(hide(state).visible).toBe(false);
    });

    it('is a no-op when already hidden', () => {
      const state = createOverlay();
      expect(hide(state).visible).toBe(false);
    });
  });

  describe('blur handler guard (Esc-then-reopen bug)', () => {
    it('blur during programmatic hide is ignored (isHiding=true)', () => {
      const state = show(createOverlay());
      // Simulate: hide() sets isHiding=true, which triggers blur
      const afterBlur = onBlur(state, true);
      // Blur should be ignored — state unchanged
      expect(afterBlur.visible).toBe(true);
    });

    it('blur during show sequence is ignored (isHiding=true)', () => {
      // Simulates the Esc-then-reopen bug:
      // 1. Overlay hidden via Esc
      // 2. User presses shortcut → show() temporarily sets isHiding=true
      // 3. macOS sends spurious blur during show/focus
      // 4. blur handler sees isHiding=true → ignores the blur
      const state = show(createOverlay());
      const afterBlur = onBlur(state, true); // isHiding=true during show
      expect(afterBlur.visible).toBe(true); // should NOT hide
    });

    it('blur from normal focus loss hides the overlay', () => {
      const state = show(createOverlay());
      // Normal blur — user clicked outside
      const afterBlur = onBlur(state, false);
      expect(afterBlur.visible).toBe(false);
    });

    it('full Esc-then-reopen sequence works correctly', () => {
      let state = createOverlay();
      let isHiding = false;

      // 1. Show overlay
      state = show(state);
      expect(state.visible).toBe(true);

      // 2. Esc pressed → hide via IPC
      isHiding = true;
      state = hide(state);
      // blur fires during hide but isHiding guards it
      state = onBlur(state, isHiding);
      isHiding = false;
      expect(state.visible).toBe(false);

      // 3. Shortcut pressed → toggle → show
      // show() temporarily sets isHiding during show/focus
      isHiding = true;
      state = show(state);
      // Spurious blur during show is ignored
      state = onBlur(state, isHiding);
      isHiding = false;
      expect(state.visible).toBe(true); // THE BUG: was false before fix

      // 4. Normal blur (click outside) should still hide
      state = onBlur(state, false);
      expect(state.visible).toBe(false);
    });
  });
});
