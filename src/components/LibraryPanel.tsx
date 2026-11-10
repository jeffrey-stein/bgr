import { X } from 'lucide-react'
import type {
  AiStatus,
  Background,
  MediaAsset,
  ProcessingState,
  ToolKey,
} from '../types'
import {
  AudioControls,
  BackdropControls,
  CutoutControls,
  ExportSummary,
  MediaGrid,
  QuickToolCards,
  UploadZone,
} from './toolPanels'
import { PrivacyNote } from './ui'

const HEADERS: Record<ToolKey, { eyebrow: string; title: string; note: string }> = {
  media: {
    eyebrow: 'Uploads',
    title: 'Your media',
    note: 'Everything stays in this browser.',
  },
  cutout: {
    eyebrow: 'Tools',
    title: 'Cutout studio',
    note: 'Remove backgrounds from images and video.',
  },
  backdrop: {
    eyebrow: 'Canvas',
    title: 'Backdrop',
    note: 'Turn a transparent cutout into a green screen.',
  },
  audio: {
    eyebrow: 'Sound',
    title: 'Audio lab',
    note: 'Pull soundtracks out of video.',
  },
  export: {
    eyebrow: 'Deliver',
    title: 'Export',
    note: 'Download a ready-to-use file.',
  },
}

export function LibraryPanel({
  tool,
  onClose,
  assets,
  activeAsset,
  processing,
  videoAiStatus,
  videoCutout,
  background,
  ratio,
  threshold,
  feather,
  invert,
  outputWidth,
  outputHeight,
  formatLabel,
  uploading,
  onUpload,
  onSelect,
  onRemoveAsset,
  onToggleVideoCutout,
  onRemoveImage,
  onRestoreImage,
  onBackground,
  onExtractAudio,
  onDownloadAudio,
  onOpenExport,
  onThreshold,
  onFeather,
  onInvert,
  onTool,
}: {
  tool: ToolKey
  onClose: () => void
  assets: MediaAsset[]
  activeAsset: MediaAsset | null
  processing: ProcessingState | null
  videoAiStatus: AiStatus
  videoCutout: boolean
  background: Background
  ratio: string
  threshold: number
  feather: number
  invert: boolean
  outputWidth: number
  outputHeight: number
  formatLabel: string
  uploading: boolean
  onUpload: () => void
  onSelect: (id: string) => void
  onRemoveAsset: (asset: MediaAsset) => void
  onToggleVideoCutout: (next: boolean) => void
  onRemoveImage: () => void
  onRestoreImage: () => void
  onBackground: (background: Background) => void
  onExtractAudio: (mode?: 'full' | 'voice' | 'background') => void
  onDownloadAudio: (asset: MediaAsset) => void
  onOpenExport: () => void
  onThreshold: (value: number) => void
  onFeather: (value: number) => void
  onInvert: (value: boolean) => void
  onTool: (tool: ToolKey) => void
}) {
  const header = HEADERS[tool]

  return (
    <aside className="library-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">{header.eyebrow}</span>
          <h1>{header.title}</h1>
          <p>{header.note}</p>
        </div>
        <button
          type="button"
          className="icon-button panel-close"
          onClick={onClose}
          aria-label="Close panel"
          title="Close panel"
        >
          <X size={16} />
        </button>
      </div>

      <div className="library-scroll">
        {tool === 'media' ? (
          <div className="panel-stack">
            <UploadZone onUpload={onUpload} uploading={uploading} />
            <MediaGrid
              assets={assets}
              activeId={activeAsset?.id ?? null}
              onSelect={onSelect}
              onRemove={onRemoveAsset}
            />
            <QuickToolCards
              asset={activeAsset}
              onCutout={() => onTool('cutout')}
              onBackdrop={() => onTool('backdrop')}
              onAudio={() => onTool('audio')}
            />
            <PrivacyNote>No cloud, no uploads. Media stays in your browser; project history is saved locally for signed-in accounts.</PrivacyNote>
          </div>
        ) : null}

        {tool === 'cutout' ? (
          <div className="panel-stack">
            <CutoutControls
              asset={activeAsset}
              processing={processing}
              videoAiStatus={videoAiStatus}
              videoCutout={videoCutout}
              onToggleVideoCutout={onToggleVideoCutout}
              onRemoveImage={onRemoveImage}
              onRestoreImage={onRestoreImage}
              threshold={threshold}
              feather={feather}
              invert={invert}
              onThreshold={onThreshold}
              onFeather={onFeather}
              onInvert={onInvert}
            />
            {activeAsset?.cutoutStatus === 'done' || videoCutout ? (
              <button
                type="button"
                className="secondary-action wide"
                onClick={() => onTool('backdrop')}
              >
                Set a green screen backdrop
              </button>
            ) : null}
          </div>
        ) : null}

        {tool === 'backdrop' ? (
          <div className="panel-stack">
            <div className="context-strip">
              <span
                className={`context-preview ${
                  background.mode === 'color' ? 'is-solid' : 'is-checker'
                }`}
                style={
                  background.mode === 'color'
                    ? { background: background.color }
                    : undefined
                }
              />
              <div>
                <strong>{formatLabel} canvas</strong>
                <span>{ratio} · {outputWidth} × {outputHeight} px</span>
              </div>
            </div>
            <BackdropControls
              background={background}
              onChange={onBackground}
              greenScreen={background.mode === 'color'}
            />
          </div>
        ) : null}

        {tool === 'audio' ? (
          <div className="panel-stack">
            <AudioControls
              asset={activeAsset}
              allAssets={assets}
              processing={processing}
              onExtract={onExtractAudio}
              onDownload={onDownloadAudio}
              onSelect={onSelect}
            />
          </div>
        ) : null}

        {tool === 'export' ? (
          <div className="panel-stack">
            <ExportSummary
              asset={activeAsset}
              background={background}
              width={outputWidth}
              height={outputHeight}
              formatLabel={formatLabel}
              onExport={onOpenExport}
            />
            <PrivacyNote>Exports are generated locally and downloaded directly.</PrivacyNote>
          </div>
        ) : null}
      </div>
    </aside>
  )
}
