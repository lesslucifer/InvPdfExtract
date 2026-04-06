import React from 'react';
import { FileStatus } from '../shared/types';
import { Icons, ICON_SIZE } from '../shared/icons';
import type { LucideIcon } from 'lucide-react';

const STATUS_CONFIG: Record<FileStatus, { icon: LucideIcon; className: string; title: string }> = {
  [FileStatus.Pending]:    { icon: Icons.hourglass, className: 'text-text-muted',            title: 'Queuing' },
  [FileStatus.Processing]: { icon: Icons.loader,    className: 'text-accent animate-spin-slow', title: 'Processing...' },
  [FileStatus.Done]:       { icon: Icons.success,   className: 'text-confidence-high',        title: 'Processed' },
  [FileStatus.Review]:     { icon: Icons.conflict,   className: 'text-confidence-medium',      title: 'Needs review' },
  [FileStatus.Error]:      { icon: Icons.error,     className: 'text-confidence-low',         title: 'Error' },
  [FileStatus.Skipped]:    { icon: Icons.skipped,   className: 'text-text-muted opacity-50',  title: 'Skipped (filtered)' },
};

interface Props {
  status: FileStatus;
  size?: number;
  onClick?: (e: React.MouseEvent) => void;
}

export const StatusIcon: React.FC<Props> = ({ status, size = ICON_SIZE.XS, onClick }) => {
  const config = STATUS_CONFIG[status];
  if (!config) return null;

  const Icon = config.icon;
  const interactive = !!onClick;

  return (
    <span
      className={`inline-flex items-center shrink-0 ${config.className} ${interactive ? 'cursor-pointer' : ''}`}
      title={config.title}
      aria-label={config.title}
      onClick={onClick}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
    >
      <Icon size={size} />
    </span>
  );
};
