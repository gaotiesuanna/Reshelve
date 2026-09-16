import {
  Activity,
  AlertTriangle,
  Bookmark,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  Download,
  ExternalLink,
  File,
  Folder,
  Link as LinkGlyph,
  Pencil,
  Plus,
  Save,
  Settings,
  Trash2,
  TrendingUp,
  Upload,
  X,
  type LucideIcon,
} from 'lucide-react'

type IconProps = { className?: string }

/** 标签页顶栏品牌。图标与扩展 action icon 同源（public/icons，tools/gen-icon.py）。 */
export function BrandMark() {
  return (
    <div className="flex shrink-0 items-center gap-2.5" data-testid="brand-mark">
      <img
        src="/icons/icon-32.png"
        alt=""
        width={32}
        height={32}
        className="h-8 w-8 rounded-index shadow-sm"
        draggable={false}
      />
      <h1 className="text-base font-semibold tracking-[-0.02em] text-index-ink">Reshelve</h1>
    </div>
  )
}


/**
 * 统一的 Lucide 适配层：现有组件继续使用语义化的 Reshelve 图标名，
 * 但实际渲染改由 lucide-react 提供，保持 24×24、1.75 描边和无障碍隐藏。
 */
function makeIcon(Glyph: LucideIcon) {
  return function ReshelveIcon({ className }: IconProps) {
    return (
      <Glyph
        aria-hidden="true"
        focusable="false"
        className={className ?? 'h-3.5 w-3.5'}
        strokeWidth={1.75}
      />
    )
  }
}

export const DownloadIcon = makeIcon(Download)
export const UploadIcon = makeIcon(Upload)
export const FileIcon = makeIcon(File)
export const FolderIcon = makeIcon(Folder)
export const LinkIcon = makeIcon(LinkGlyph)
export const BookmarkIcon = makeIcon(Bookmark)
export const CheckCircleIcon = makeIcon(CheckCircle)
export const AlertIcon = makeIcon(AlertTriangle)
export const SettingsIcon = makeIcon(Settings)
export const OpenInTabIcon = makeIcon(ExternalLink)
export const ActivityIcon = makeIcon(Activity)
export const PencilIcon = makeIcon(Pencil)
export const TrashIcon = makeIcon(Trash2)
export const SaveIcon = makeIcon(Save)
export const CloseIcon = makeIcon(X)
export const PlusIcon = makeIcon(Plus)
export const ChevronLeftIcon = makeIcon(ChevronLeft)
export const ChevronDownIcon = makeIcon(ChevronDown)
export const TrendingUpIcon = makeIcon(TrendingUp)

/**
 * GitHub 品牌标仍保留专用实心路径；Lucide 不提供品牌 logo，不能用近似图标替代。
 */
export function GithubIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      aria-hidden="true"
      focusable="false"
      className={className ?? 'h-3.5 w-3.5'}
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  )
}
