import { describe, it, expect } from 'vitest';
import { FileStatus, OverlayState } from '../shared/types';

// === StatusIcon logic ===

const STATUS_TITLES: Record<FileStatus, string> = {
  [FileStatus.Unfiltered]: 'Queuing',
  [FileStatus.Pending]: 'Queuing',
  [FileStatus.Processing]: 'Processing...',
  [FileStatus.Done]: 'Processed',
  [FileStatus.Review]: 'Needs review',
  [FileStatus.Error]: 'Error',
  [FileStatus.Skipped]: 'Skipped (filtered)',
};

function getStatusTitle(status: FileStatus): string {
  return STATUS_TITLES[status] || status;
}

const STATUS_ICON_NAMES: Record<FileStatus, string> = {
  [FileStatus.Unfiltered]: 'hourglass',
  [FileStatus.Pending]:    'hourglass',
  [FileStatus.Processing]: 'loader',
  [FileStatus.Done]:       'success',
  [FileStatus.Review]:     'conflict',
  [FileStatus.Error]:      'error',
  [FileStatus.Skipped]:    'skipped',
};

function getStatusIconName(status: FileStatus): string {
  return STATUS_ICON_NAMES[status] ?? 'unknown';
}

// === Folder status aggregation logic ===

const STATUS_PRIORITY: Record<string, number> = {
  [FileStatus.Processing]: 0,
  [FileStatus.Error]: 1,
  [FileStatus.Review]: 2,
  [FileStatus.Pending]: 3,
  [FileStatus.Done]: 4,
};

function aggregateFolderStatus(fileStatuses: FileStatus[]): FileStatus | null {
  if (fileStatuses.length === 0) return null;
  let best = fileStatuses[0];
  for (const s of fileStatuses) {
    if ((STATUS_PRIORITY[s] ?? 5) < (STATUS_PRIORITY[best] ?? 5)) {
      best = s;
    }
  }
  return best;
}

// === ProcessingStatus state transitions ===

function handleProcessingStatusBack(previousState: OverlayState): OverlayState {
  return previousState === OverlayState.ProcessingStatus ? OverlayState.Home : previousState;
}

function handleStatusDotClick(): OverlayState {
  return OverlayState.ProcessingStatus;
}

// === Tests ===

describe('StatusIcon', () => {
  it('returns correct title for each status', () => {
    expect(getStatusTitle(FileStatus.Pending)).toBe('Queuing');
    expect(getStatusTitle(FileStatus.Processing)).toBe('Processing...');
    expect(getStatusTitle(FileStatus.Done)).toBe('Processed');
    expect(getStatusTitle(FileStatus.Review)).toBe('Needs review');
    expect(getStatusTitle(FileStatus.Error)).toBe('Error');
  });

  it('maps each status to a distinct icon name', () => {
    expect(getStatusIconName(FileStatus.Pending)).toBe('hourglass');
    expect(getStatusIconName(FileStatus.Processing)).toBe('loader');
    expect(getStatusIconName(FileStatus.Done)).toBe('success');
    expect(getStatusIconName(FileStatus.Review)).toBe('conflict');
    expect(getStatusIconName(FileStatus.Error)).toBe('error');
    expect(getStatusIconName(FileStatus.Skipped)).toBe('skipped');
  });
});

describe('Folder status aggregation', () => {
  it('returns null for empty array', () => {
    expect(aggregateFolderStatus([])).toBeNull();
  });

  it('returns processing when any file is processing', () => {
    expect(aggregateFolderStatus([FileStatus.Done, FileStatus.Processing, FileStatus.Pending]))
      .toBe(FileStatus.Processing);
  });

  it('returns error when no processing but has error', () => {
    expect(aggregateFolderStatus([FileStatus.Done, FileStatus.Error, FileStatus.Pending]))
      .toBe(FileStatus.Error);
  });

  it('returns review when no processing/error but has review', () => {
    expect(aggregateFolderStatus([FileStatus.Done, FileStatus.Review]))
      .toBe(FileStatus.Review);
  });

  it('returns pending when only pending and done', () => {
    expect(aggregateFolderStatus([FileStatus.Done, FileStatus.Pending]))
      .toBe(FileStatus.Pending);
  });

  it('returns done when all files are done', () => {
    expect(aggregateFolderStatus([FileStatus.Done, FileStatus.Done]))
      .toBe(FileStatus.Done);
  });
});

describe('ProcessingStatus state transitions', () => {
  it('clicking status dot navigates to ProcessingStatus', () => {
    expect(handleStatusDotClick()).toBe(OverlayState.ProcessingStatus);
  });

  it('back from ProcessingStatus returns to previous state', () => {
    expect(handleProcessingStatusBack(OverlayState.Home)).toBe(OverlayState.Home);
    expect(handleProcessingStatusBack(OverlayState.Search)).toBe(OverlayState.Search);
  });

  it('back from ProcessingStatus when previous was also ProcessingStatus falls back to Home', () => {
    expect(handleProcessingStatusBack(OverlayState.ProcessingStatus)).toBe(OverlayState.Home);
  });
});
