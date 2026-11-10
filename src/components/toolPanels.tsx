import * as React from 'react'
import {
  AlertCircle,
  AudioLines,
  Check,
  CheckCircle2,
  Clock3,
  Download,
  FileAudio,
  Film,
  Image as ImageIcon,
  Loader2,
  Music2,
  Mic,
  Plus,
  RotateCcw,
  Scissors,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  WandSparkles,
  Wind,
} from 'lucide-react'
import type {
  AiStatus,
  Background,
  MediaAsset,
  ProcessingState,
} from '../types'
import { formatBytes, formatTime, isGreen } from '../lib/utils'import {
  AudioPlayer,
  BackdropPicker,
  PrivacyNote,
  RangeControl,
  Toggle,
  WaveBars,
} from './ui'

export function UploadZone({
  onUpload,
  compact = false,
  uploading = false,
}: {
  onUpload: () => void
  compact?: boolean
  uploading?: boolean
}) {
  return (
    <button
      type="button"
      className={`upload-zone ${compact ? 'is-compact' : ''}`}
      onClick={onUpload}
      disabled={uploading}
    >
      <span className="upload-icon">
        {uploading ? <Loader2 size={19} className="spin" /> : <UploadCloud size={19} />}
      </span>
      <span className="upload-copy">
        <strong>{uploading ? 'Reading your files…' : 'Upload media'}</strong>
        <small>Images and videos · drag & drop anywhere</small>
      </span>
      <span className="upload-plus">
        <Plus size={15} />
      </span>
    </button>
  )
}

export function MediaGrid({
  assets,
  activeId,
  onSelect,
  onRemove,
}: {
  assets: MediaAsset[]
  activeId: string | null
  onSelect: (id: string) => void
  onRemove: (asset: MediaAsset) => void
}) {
  if (!assets.length) {
    return (
      <div className="empty-panel">
        <div className="empty-panel-icon">
          <ImageIcon size={19} />
        </div>
        <strong>Your media lives here</strong>
        <span>Upload an image or video to start cutting out backgrounds.</span>
      </div>
    )
  }

  return (
    <>
      <div className="panel-subhead">
        <span>In this project</span>
        <span>{assets.length} item{assets.length === 1 ? '' : 's'}</span>
      </div>
      <div className="asset-grid">
        {assets.map((asset) => (
          <div
            className={`asset-tile ${asset.id === activeId ? 'is-active' : ''}`}
            key={asset.id}
          >
            <button
              type="button"
              className="asset-main"
              onClick={() => onSelect(asset.id)}
              title={asset.name}
            >
              <span className="asset-thumb">
                {asset.thumbUrl ? (
                  <img src={asset.thumbUrl} alt="" draggable={false} />
                ) : (
                  <span className="asset-placeholder">
                    {asset.kind === 'video' ? <Film size={24} /> : <ImageIcon size={24} />}
                  </span>
                )}
                <span className="asset-kind">
                  {asset.kind === 'video' ? <Film size={11} /> : <ImageIcon size={11} />}
                  {asset.kind === 'video' ? 'Video' : 'Image'}
                </span>
                {asset.kind === 'video' ? (
                  <span className="asset-duration">{formatTime(asset.duration)}</span>
                ) : null}
                {asset.cutoutStatus === 'done' || asset.videoCutout ? (
                  <span className="asset-cutout-badge">
                    <Check size={10} /> Cutout
                  </span>
                ) : null}
              </span>
              <span className="asset-name">{asset.name}</span>
              <span className="asset-meta">
                {asset.width}×{asset.height} · {formatBytes(asset.size)}
              </span>
            </button>
            <button
              type="button"
              className="asset-remove"
              onClick={() => onRemove(asset)}
              aria-label={`Remove ${asset.name}`}
              title="Remove from project"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </>
  )
}

export function CutoutControls({
  asset,
  processing,
  videoAiStatus,
  videoCutout,
  onToggleVideoCutout,
  onRemoveImage,
  onRestoreImage,
  threshold,
  feather,
  invert,
  onThreshold,
  onFeather,
  onInvert,
}: {
  asset: MediaAsset | null
  processing: ProcessingState | null
  videoAiStatus: AiStatus
  videoCutout: boolean
  onToggleVideoCutout: (next: boolean) => void
  onRemoveImage: () => void
  onRestoreImage: () => void
  threshold: number
  feather: number
  invert: boolean
  onThreshold: (value: number) => void
  onFeather: (value: number) => void
  onInvert: (value: boolean) => void
}) {
  if (!asset) {
    return (
      <div className="empty-panel">
        <div className="empty-panel-icon">
          <WandSparkles size={19} />
        </div>
        <strong>Select something first</strong>
        <span>Choose an image or video from Media, then remove its background here.</span>
      </div>
    )
  }

  const cutoutBusy =
    processing?.assetId === asset.id && processing.kind === 'image-cutout'
  const done = asset.kind === 'image' && asset.cutoutStatus === 'done'

  if (asset.kind === 'video') {
    return (
      <div className="cutout-controls">
        <div className={`ai-status-card ${videoCutout ? 'is-on' : ''}`}>
          <div className="ai-status-top">
            <span className="ai-orb">
              {videoAiStatus === 'loading' ? (
                <Loader2 size={19} className="spin" />
              ) : (
                <Sparkles size={19} />
              )}
            </span>
            <div>
              <strong>Live background removal</strong>
              <span>
                {videoCutout
                  ? videoAiStatus === 'loading'
                    ? 'Warming up the on-device model…'
                    : videoAiStatus === 'error'
                      ? 'The model could not start.'
                      : 'Person cutout is running live.'
                  : 'Turn any video into a green screen clip.'}
              </span>
            </div>
            <Toggle
              checked={videoCutout}
              onChange={onToggleVideoCutout}
              label="Live video background removal"
            />
          </div>
          {videoCutout && videoAiStatus === 'loading' ? (
            <div className="indeterminate-bar">
              <span />
            </div>
          ) : null}
          <div className="ai-feature-row">
            <span><CheckCircle2 size={12} /> Person-aware</span>
            <span><Clock3 size={12} /> Real-time</span>
            <span><ShieldCheck size={12} /> On-device</span>
          </div>
        </div>

        {videoCutout ? (
          <div className="advanced-box">
            <div className="advanced-title">
              <span>Edge refinement</span>
              <span className="live-dot">Live</span>
            </div>
            <RangeControl
              label="Edge threshold"
              value={threshold}
              min={0.2}
              max={0.8}
              step={0.01}
              onChange={onThreshold}
              valueLabel={`${Math.round(threshold * 100)}%`}
            />
            <RangeControl
              label="Softness"
              value={feather}
              min={0.01}
              max={0.25}
              step={0.01}
              onChange={onFeather}
              valueLabel={`${Math.round(feather * 100)}%`}
            />
            <label className="inline-toggle">
              <span>
                <strong>Invert mask</strong>
                <small>Useful when the foreground is detected instead</small>
              </span>
              <Toggle
                checked={invert}
                onChange={onInvert}
                label="Invert segmentation mask"
              />
            </label>
          </div>
        ) : null}

        <PrivacyNote>
          Video is segmented frame-by-frame in your browser. Nothing is uploaded.
        </PrivacyNote>
      </div>
    )
  }

  return (
    <div className="cutout-controls">
      <div className={`cutout-preview-card ${done ? 'is-done' : ''}`}>
        <div className="cutout-preview-image">
          <img src={asset.cutoutUrl ?? asset.url} alt="" />
          {cutoutBusy ? (
            <div className="cutout-loading">
              <Loader2 size={22} className="spin" />
              <span>{processing?.label ?? 'Removing background'}</span>
              <b>{Math.round(processing?.progress ?? 0)}%</b>
            </div>
          ) : null}
          {done ? (
            <span className="cutout-done-badge">
              <CheckCircle2 size={12} /> Cutout ready
            </span>
          ) : null}
        </div>
        {done ? (
          <button
            type="button"
            className="ghost-action"
            onClick={onRestoreImage}
          >
            <RotateCcw size={14} /> Restore original
          </button>
        ) : (
          <button
            type="button"
            className="primary-action"
            onClick={onRemoveImage}
            disabled={cutoutBusy}
          >
            {cutoutBusy ? (
              <Loader2 size={15} className="spin" />
            ) : (
              <WandSparkles size={15} />
            )}
            {cutoutBusy ? 'Removing background…' : 'Remove background'}
          </button>
        )}
      </div>

      {cutoutBusy ? (
        <div className="cutout-progress">
          <div className="progress-track">
            <span style={{ width: `${Math.max(4, processing?.progress ?? 0)}%` }} />
          </div>
          <div className="progress-copy">
            <span>{processing?.label}</span>
            <b>{Math.round(processing?.progress ?? 0)}%</b>
          </div>
        </div>
      ) : null}

      {!done && !cutoutBusy ? (
        <div className="model-note">
          <Sparkles size={15} />
          <div>
            <strong>Subject-aware cutout</strong>
            <span>
              High-quality matting for people, products and objects. The model
              downloads once, then runs locally.
            </span>
          </div>
        </div>
      ) : null}

      <PrivacyNote>Images never leave this device.</PrivacyNote>
    </div>
  )
}

export function BackdropControls({
  background,
  onChange,
  greenScreen,
}: {
  background: Background
  onChange: (background: Background) => void
  greenScreen: boolean
}) {
  return (
    <div className="backdrop-controls">
      <div className={`green-hero ${greenScreen ? 'is-on' : ''}`}>
        <span className="green-hero-glow" />
        <div className="green-hero-icon">
          <PaintBucketIcon />
        </div>
        <div>
          <strong>{greenScreen ? 'Green screen is on' : 'Make it a green screen'}</strong>
          <span>
            {greenScreen
              ? 'Your cutout sits on standard chroma green.'
              : 'Swap the backdrop to clean chroma green in one click.'}
          </span>
        </div>
        <Toggle
          checked={greenScreen}
          onChange={(next) =>
            onChange(
              next
                ? { mode: 'color', color: '#00B140' }
                : { mode: 'transparent' },
            )
          }
          label="Green screen backdrop"
        />
      </div>
      <BackdropPicker background={background} onChange={onChange} />
      <div className="tip-card">
        <span>Tip</span>
        Combine a cutout with chroma green for editing in Premiere, CapCut,
        OBS, or any editor with a chroma key.
      </div>
    </div>
  )
}

function PaintBucketIcon() {
  return <Scissors size={21} />
}

export function AudioControls({
  asset,
  allAssets,
  processing,
  onExtract,
  onDownload,
  onSelect,
}: {
  asset: MediaAsset | null
  allAssets: MediaAsset[]
  processing: ProcessingState | null
  onExtract: (mode?: 'full' | 'voice' | 'background') => void
  onDownload: (asset: MediaAsset) => void
  onSelect: (id: string) => void
}) {
  const audioBusy =
    asset && processing?.assetId === asset.id && processing.kind === 'audio'
  const audioAssets = allAssets.filter((item) => item.audio)
  const [extractMode, setExtractMode] = React.useState<'full' | 'voice' | 'background'>(
    'full'
  )

  if (!asset) {
    return (
      <div className="empty-panel">
        <div className="empty-panel-icon">
          <Music2 size={19} />
        </div>
        <strong>Select a video</strong>
        <span>Extract clean WAV audio from any video in your project.</span>
      </div>
    )
  }

  if (asset.kind !== 'video') {
    return (
      <div className="empty-panel">
        <div className="empty-panel-icon">
          <Film size={19} />
        </div>
        <strong>Audio comes from video</strong>
        <span>Select a video clip to pull its soundtrack out as a WAV file.</span>
      </div>
    )
  }

  return (
    <div className="audio-controls">
      <div className="audio-extract-card">
        <div className="audio-extract-icon">
          <AudioLines size={21} />
          <WaveBars active={!!asset.audio} />
        </div>
        <div className="audio-extract-copy">
          <strong>
            {asset.audio
              ? asset.audioMode === 'voice'
                ? 'Vocals isolated'
                : asset.audioMode === 'background'
                  ? 'Background isolated'
                  : 'Soundtrack extracted'
              : 'Extract soundtrack'}
          </strong>
          <span>
            {asset.audio
              ? `${formatTime(asset.audio.duration)} · ${Math.round(
                  asset.audio.sampleRate / 1000,
                )} kHz WAV (${asset.audioMode ?? 'full'})`
              : 'Pull the audio out of this video as a lossless WAV.'}
          </span>
        </div>
        {asset.audio ? (
          <button
            type="button"
            className="primary-action compact"
            onClick={() => onDownload(asset)}
          >
            <Download size={14} /> WAV
          </button>
        ) : (
          <>
            <div className="audio-mode-row">
              <button
                type="button"
                className={`mode-chip ${
                  extractMode === 'full' ? 'is-active' : ''
                }`}
                onClick={() => setExtractMode('full')}
                title="Full soundtrack"
              >
                Full
              </button>
              <button
                type="button"
                className={`mode-chip ${
                  extractMode === 'voice' ? 'is-active' : ''
                }`}
                onClick={() => setExtractMode('voice')}
                title="Isolate voice"
              >
                <Mic size={13} /> Voice
              </button>
              <button
                type="button"
                className={`mode-chip ${
                  extractMode === 'background' ? 'is-active' : ''
                }`}
                onClick={() => setExtractMode('background')}
                title="Isolate background noise"
              >
                <Wind size={13} /> Background
              </button>
            </div>
            <button
              type="button"
              className="primary-action compact"
              onClick={() => onExtract(extractMode)}
              disabled={audioBusy}
            >
              {audioBusy ? <Loader2 size={14} className="spin" /> : <Scissors size={14} />}
              {audioBusy ? 'Extracting' : 'Extract'}
            </button>
          </>
        )}
      </div>

      {audioBusy ? (
        <div className="cutout-progress">
          <div className="progress-track">
            <span style={{ width: `${Math.max(8, processing?.progress ?? 0)}%` }} />
          </div>
          <div className="progress-copy">
            <span>{processing?.label}</span>
            <b>{Math.round(processing?.progress ?? 0)}%</b>
          </div>
        </div>
      ) : null}

      {asset.audio ? (
        <AudioPlayer
          src={asset.audio.url}
          waveform={asset.audio.waveform}
          duration={asset.audio.duration}
          onDownload={() => onDownload(asset)}
        />
      ) : (
        <div className="model-note">
          <FileAudio size={15} />
          <div>
            <strong>Original quality</strong>
            <span>
              Audio is decoded locally and exported as 16-bit PCM WAV. No
              compression, no upload.
            </span>
          </div>
        </div>
      )}

      {audioAssets.length > 1 ? (
        <div className="audio-library">
          <div className="panel-subhead">
            <span>Extracted audio</span>
            <span>{audioAssets.length}</span>
          </div>
          {audioAssets.map((item) => (
            <button
              type="button"
              key={item.id}
              className={`audio-library-row ${item.id === asset.id ? 'is-active' : ''}`}
              onClick={() => onSelect(item.id)}
            >
              <span className="audio-library-icon">
                <FileAudio size={15} />
              </span>
              <span className="audio-library-copy">
                <strong>{item.name.replace(/\.[^.]+$/, '')}.wav</strong>
                <small>{formatTime(item.audio?.duration ?? 0)}</small>
              </span>
              <span className="audio-library-dl">
                <Download size={13} />
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <PrivacyNote>Audio extraction never touches a server.</PrivacyNote>
    </div>
  )
}

export function ExportSummary({
  asset,
  background,
  width,
  height,
  formatLabel,
  onExport,
}: {
  asset: MediaAsset | null
  background: Background
  width: number
  height: number
  formatLabel: string
  onExport: () => void
}) {
  if (!asset) {
    return (
      <div className="empty-panel">
        <div className="empty-panel-icon">
          <Download size={19} />
        </div>
        <strong>Nothing to export yet</strong>
        <span>Upload media, remove the background, then export your green screen file.</span>
      </div>
    )
  }

  return (
    <div className="export-summary">
      <div
        className="export-preview"
        style={{
          background: background.mode === 'color' ? background.color : undefined,
        }}
      >
        {background.mode === 'transparent' ? (
          <span className="checker-swatch full" />
        ) : null}
        <img src={asset.cutoutUrl ?? asset.thumbUrl ?? asset.url} alt="" />
        <span className="export-type-chip">
          {asset.kind === 'video' ? <Film size={11} /> : <ImageIcon size={11} />}
          {formatLabel}
        </span>
      </div>
      <div className="export-meta-grid">
        <span>
          <small>Canvas</small>
          <strong>{width} × {height}</strong>
        </span>
        <span>
          <small>Backdrop</small>
          <strong>
            {background.mode === 'color'
              ? isGreen(background.color)
                ? 'Chroma green'
                : background.color.toUpperCase()
              : 'Transparent'}
          </strong>
        </span>
        <span>
          <small>Type</small>
          <strong>{asset.kind === 'video' ? 'Green screen video' : 'Cutout image'}</strong>
        </span>
        <span>
          <small>Privacy</small>
          <strong>On-device</strong>
        </span>
      </div>
      {asset.kind === 'video' ? (
        <div className="export-note">
          <Clock3 size={14} />
          Video exports render in real time, so a {formatTime(asset.duration)} clip
          takes about {formatTime(asset.duration)}.
        </div>
      ) : null}
      <button type="button" className="primary-action wide" onClick={onExport}>
        <Download size={16} />
        Export {formatLabel}
        <span className="action-kbd">⌘E</span>
      </button>
    </div>
  )
}

export function QuickToolCards({
  asset,
  onCutout,
  onBackdrop,
  onAudio,
}: {
  asset: MediaAsset | null
  onCutout: () => void
  onBackdrop: () => void
  onAudio: () => void
}) {
  return (
    <div className="quick-tools">
      <button type="button" className="quick-tool" onClick={onCutout} disabled={!asset}>
        <span className="quick-icon lime"><WandSparkles size={16} /></span>
        <span>
          <strong>Remove background</strong>
          <small>{asset?.kind === 'video' ? 'Live cutout' : 'Subject cutout'}</small>
        </span>
      </button>
      <button type="button" className="quick-tool" onClick={onBackdrop}>
        <span className="quick-icon green"><Sparkles size={16} /></span>
        <span>
          <strong>Green screen</strong>
          <small>Chroma backdrop</small>
        </span>
      </button>
      <button type="button" className="quick-tool" onClick={onAudio} disabled={asset?.kind !== 'video'}>
        <span className="quick-icon peach"><Music2 size={16} /></span>
        <span>
          <strong>Extract audio</strong>
          <small>Lossless WAV</small>
        </span>
      </button>
    </div>
  )
}

export function AssetDetail({ asset }: { asset: MediaAsset | null }) {
  if (!asset) return null
  return (
    <div className="asset-detail">
      <div className="asset-detail-thumb">
        <img src={asset.cutoutUrl ?? asset.thumbUrl ?? asset.url} alt="" />
      </div>
      <div className="asset-detail-copy">
        <strong>{asset.name}</strong>
        <span>
          {asset.kind === 'video' ? 'Video' : 'Image'} · {asset.width}×{asset.height}
        </span>
        <span>
          {formatBytes(asset.size)}
          {asset.kind === 'video' ? ` · ${formatTime(asset.duration)}` : ''}
        </span>
      </div>
      <span className={`asset-status-dot ${asset.cutoutStatus === 'done' || asset.videoCutout ? 'is-on' : ''}`}>
        {asset.cutoutStatus === 'done' || asset.videoCutout ? <Check size={11} /> : null}
      </span>
    </div>
  )
}

export function ProcessingBanner({
  processing,
}: {
  processing: ProcessingState | null
}) {
  if (!processing) return null
  return (
    <div className="processing-banner">
      <Loader2 size={14} className="spin" />
      <span>{processing.label}</span>
      <div className="processing-banner-track">
        <span style={{ width: `${processing.progress}%` }} />
      </div>
      <b>{Math.round(processing.progress)}%</b>
    </div>
  )
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="error-note">
      <AlertCircle size={14} />
      <span>{message}</span>
    </div>
  )
}
