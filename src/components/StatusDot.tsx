import React from 'react';
import { FileStatus } from '../shared/types';

const STATUS_TITLES: Record<FileStatus, string> = {
  [FileStatus.Pending]: 'Queuing',
  [FileStatus.Processing]: 'Processing...',
  [FileStatus.Done]: 'Processed',
  [FileStatus.Review]: 'Needs review',
  [FileStatus.Error]: 'Error',
  [FileStatus.Skipped]: 'Skipped (filtered)',
};

const STATUS_CLASSES: Record<FileStatus, string> = {
  [FileStatus.Pending]:    'bg-text-muted',
  [FileStatus.Processing]: 'bg-accent animate-status-pulse',
  [FileStatus.Done]:       'bg-confidence-high',
  [FileStatus.Review]:     'bg-confidence-medium',
  [FileStatus.Error]:      'bg-confidence-low',
  [FileStatus.Skipped]:    'bg-text-muted opacity-50',
};

interface Props {
  status: FileStatus;
  onClick?: (e: React.MouseEvent) => void;
}

export const StatusDot: React.FC<Props> = ({ status, onClick }) => {
  const title = STATUS_TITLES[status] || status;
  return (
    <span
      className={`w-[5px] h-[5px] rounded-full shrink-0 inline-block align-middle mx-1 ${STATUS_CLASSES[status]}`}
      title={title}
      aria-label={title}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    />
  );
};
