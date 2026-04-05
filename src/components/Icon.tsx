import React from 'react';
import { Icons, ICON_SIZE, type IconName } from '../shared/icons';

interface Props {
  name: IconName;
  size?: number;
  className?: string;
}

export const Icon: React.FC<Props> = ({ name, size = ICON_SIZE.MD, className }) => {
  const LucideIcon = Icons[name];
  return <LucideIcon size={size} className={className} />;
};
