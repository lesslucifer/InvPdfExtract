import { describe, it, expect } from 'vitest';
import { OverlayState, AppConfig } from '../shared/types';

/**
 * Tests for the overlay state machine logic.
 *
 * Since the React component can't be rendered in a node environment,
 * we extract and test the state transition logic as pure functions.
 */

// === Extracted state logic (mirrors SearchOverlay.tsx) ===

function determineInitialState(config: AppConfig): OverlayState {
  if (!config.lastVaultPath || !config.vaultPaths || config.vaultPaths.length === 0) {
    return OverlayState.NoVault;
  }
  return OverlayState.Home;
}

interface StateTransition {
  current: OverlayState;
  previous: OverlayState;
}

function goTo(transition: StateTransition, target: OverlayState): StateTransition {
  return {
    current: target,
    previous: transition.current,
  };
}

type EscapeResult = {
  newState?: OverlayState;
  clearExpanded?: boolean;
  clearQuery?: boolean;
};

function handleEscape(
  overlayState: OverlayState,
  previousState: OverlayState,
  expandedId: string | null,
  query: string,
): EscapeResult {
  if (overlayState === OverlayState.Settings) {
    const backTo = previousState === OverlayState.Settings ? OverlayState.Home : previousState;
    return { newState: backTo };
  }
  if (expandedId) {
    return { clearExpanded: true };
  }
  if (query) {
    return { clearQuery: true };
  }
  // Nothing to undo — window blur will hide
  return {};
}

function handleQueryChange(
  value: string,
  currentState: OverlayState,
): OverlayState {
  if (value.trim() && currentState === OverlayState.Home) {
    return OverlayState.Search;
  }
  if (!value.trim() && currentState === OverlayState.Search) {
    return OverlayState.Home;
  }
  return currentState;
}

// === Tests ===

describe('Overlay State Machine', () => {
  describe('determineInitialState', () => {
    it('returns NoVault when lastVaultPath is null', () => {
      const config: AppConfig = {
        lastVaultPath: null,
        claudeCliPath: null,
        vaultPaths: [],
        autoStart: false,
      };
      expect(determineInitialState(config)).toBe(OverlayState.NoVault);
    });

    it('returns NoVault when vaultPaths is empty', () => {
      const config: AppConfig = {
        lastVaultPath: '/some/path',
        claudeCliPath: null,
        vaultPaths: [],
        autoStart: false,
      };
      expect(determineInitialState(config)).toBe(OverlayState.NoVault);
    });

    it('returns Home when a vault is configured', () => {
      const config: AppConfig = {
        lastVaultPath: '/Users/test/vault',
        claudeCliPath: null,
        vaultPaths: ['/Users/test/vault'],
        autoStart: false,
      };
      expect(determineInitialState(config)).toBe(OverlayState.Home);
    });
  });

  describe('goTo (state transitions)', () => {
    it('transitions from Home to Settings, tracking previous', () => {
      const result = goTo(
        { current: OverlayState.Home, previous: OverlayState.Home },
        OverlayState.Settings,
      );
      expect(result.current).toBe(OverlayState.Settings);
      expect(result.previous).toBe(OverlayState.Home);
    });

    it('transitions from NoVault to Home after vault creation', () => {
      const result = goTo(
        { current: OverlayState.NoVault, previous: OverlayState.NoVault },
        OverlayState.Home,
      );
      expect(result.current).toBe(OverlayState.Home);
      expect(result.previous).toBe(OverlayState.NoVault);
    });

    it('transitions from Search to Settings', () => {
      const result = goTo(
        { current: OverlayState.Search, previous: OverlayState.Home },
        OverlayState.Settings,
      );
      expect(result.current).toBe(OverlayState.Settings);
      expect(result.previous).toBe(OverlayState.Search);
    });
  });

  describe('handleEscape (escape cascade)', () => {
    it('returns to previous state when in Settings', () => {
      const result = handleEscape(OverlayState.Settings, OverlayState.Home, null, '');
      expect(result.newState).toBe(OverlayState.Home);
    });

    it('returns to Home when previous was also Settings (safety)', () => {
      const result = handleEscape(OverlayState.Settings, OverlayState.Settings, null, '');
      expect(result.newState).toBe(OverlayState.Home);
    });

    it('returns to Search when settings was opened from Search', () => {
      const result = handleEscape(OverlayState.Settings, OverlayState.Search, null, '');
      expect(result.newState).toBe(OverlayState.Search);
    });

    it('collapses expanded detail before clearing query', () => {
      const result = handleEscape(OverlayState.Search, OverlayState.Home, 'record-123', 'test query');
      expect(result.clearExpanded).toBe(true);
      expect(result.clearQuery).toBeUndefined();
      expect(result.newState).toBeUndefined();
    });

    it('clears query when no detail is expanded', () => {
      const result = handleEscape(OverlayState.Search, OverlayState.Home, null, 'test query');
      expect(result.clearQuery).toBe(true);
      expect(result.clearExpanded).toBeUndefined();
    });

    it('returns empty when nothing to undo (Home, no query, no expanded)', () => {
      const result = handleEscape(OverlayState.Home, OverlayState.Home, null, '');
      expect(result.newState).toBeUndefined();
      expect(result.clearExpanded).toBeUndefined();
      expect(result.clearQuery).toBeUndefined();
    });
  });

  describe('handleQueryChange (auto state transitions)', () => {
    it('transitions Home -> Search when user types', () => {
      const newState = handleQueryChange('hello', OverlayState.Home);
      expect(newState).toBe(OverlayState.Search);
    });

    it('transitions Search -> Home when query is cleared', () => {
      const newState = handleQueryChange('', OverlayState.Search);
      expect(newState).toBe(OverlayState.Home);
    });

    it('stays in Search when query changes but stays non-empty', () => {
      const newState = handleQueryChange('new query', OverlayState.Search);
      expect(newState).toBe(OverlayState.Search);
    });

    it('stays in Home when query remains empty', () => {
      const newState = handleQueryChange('', OverlayState.Home);
      expect(newState).toBe(OverlayState.Home);
    });

    it('does not transition from Settings when typing', () => {
      const newState = handleQueryChange('hello', OverlayState.Settings);
      expect(newState).toBe(OverlayState.Settings);
    });

    it('does not transition from NoVault when typing', () => {
      const newState = handleQueryChange('hello', OverlayState.NoVault);
      expect(newState).toBe(OverlayState.NoVault);
    });

    it('treats whitespace-only as empty', () => {
      const newState = handleQueryChange('   ', OverlayState.Search);
      expect(newState).toBe(OverlayState.Home);
    });
  });
});
