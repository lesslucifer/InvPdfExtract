import React from 'react';
import { FileStatus } from '../shared/types';

const STATUS_TITLES: Record<FileStatus, string> = {
  [FileStatus.Pending]: 'Queuing',
  [FileStatus.Processing]: 'Processing...',
  [FileStatus.Done]: 'Processed',
  [FileStatus.Review]: 'Needs review',
  [FileStatus.Error]: 'Error',
};

interface Props {
  status: FileStatus;
  onClick?: (e: React.MouseEvent) => void;
}

export const StatusDot: React.FC<Props> = ({ status, onClick }) => {
  const title = STATUS_TITLES[status] || status;
  return (
    <span
      className={`status-dot-file status-dot-file--${status}`}
      title={title}
      aria-label={title}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    />
  );
};
