import {
  CircleDollarSign,
  FileOutput,
  FileInput,
  File,
  Folder,
  FolderOpen,
  AlertTriangle,
  PenLine,
  Banknote,
  Calendar,
  Search,
  Settings,
  RotateCcw,
  RefreshCcwDot,
  X,
  Check,
  Copy,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Star,
  Zap,
  Eye,
  Percent,
  Clock,
  ClipboardList,
  ArrowLeftRight,
  AppWindow,
  ChevronRight,
  Download,
  type LucideIcon,
  CircleAlert,
  FingerprintPattern,
  CircleHelp,
  Hourglass,
  LoaderCircle,
  CircleCheck,
  CircleX,
  CircleSlash,
} from 'lucide-react';

export const ICON_SIZE = {
  XS: 10,
  SM: 12,
  MD: 16,
  LG: 20,
} as const;

export const Icons = {
  // Document types
  bankStatement: CircleDollarSign,
  invoiceOut: FileOutput,
  invoiceIn: FileInput,
  file: File,
  folder: Folder,
  folderOpen: FolderOpen,

  // Status
  conflict: AlertTriangle,
  overridden: PenLine,
  hourglass: Hourglass,
  loader: LoaderCircle,
  success: CircleCheck,
  error: CircleX,
  skipped: CircleSlash,

  // Filters
  amount: Banknote,
  calendar: Calendar,
  clock: Clock,
  target: Percent,
  clipboardList: ClipboardList,
  zap: Zap,
  eye: Eye,

  // Actions
  search: Search,
  settings: Settings,
  refresh: RotateCcw,
  refreshJE: RefreshCcwDot,
  close: X,
  check: Check,
  copy: Copy,
  arrowLeft: ArrowLeft,
  arrowUp: ArrowUp,
  arrowDown: ArrowDown,
  arrowUpDown: ArrowUpDown,
  arrowLeftRight: ArrowLeftRight,
  star: Star,
  maximize: AppWindow,
  chevronRight: ChevronRight,
  download: Download,
  mismatch: CircleAlert,
  fingerprint: FingerprintPattern,
  circleHelp: CircleHelp,
} as const;

export type IconName = keyof typeof Icons;

export function getIcon(name: IconName): LucideIcon {
  return Icons[name];
}

export const DOC_TYPE_ICONS: Record<string, { icon: LucideIcon; label: string }> = {
  bank_statement: { icon: CircleDollarSign, label: 'Bank Statement' },
  invoice_out: { icon: FileOutput, label: 'Invoice Out' },
  invoice_in: { icon: FileInput, label: 'Invoice In' },
  unknown: { icon: File, label: 'Unknown' },
};
