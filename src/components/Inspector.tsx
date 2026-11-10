import {
  AudioLines,
  CheckCircle2,
  Download,
  Film,
  Image as ImageIcon,
  Loader2,
  RotateCcw,
  Scissors,
  Sparkles,
  WandSparkles,
  X,
} from 'lucide-react'
import type {
  AiStatus,
  Background,
  FitMode,
  MediaAsset,
  ProcessingState,
  RatioKey,
} from '../types'
import { formatTime, isGreen } from '../lib/utils'
import { AssetDetail } from './toolPanels'
import {
  AudioPlayer,
  BackdropPicker,
  PrivacyNote,
  RangeControl,
  RatioPicker,
  Section,
  Toggle,
} from './ui'

export function Inspector({
  asset,
  ratio,
  fit,
  background,
  videoCutout,
  processing,
  videoAiStatus,
  threshold,
  feather,
  invert,
  outputWidth,
  outputHeight,
  formatLabel,
  onClose,
  onRatio,
  onFit,
  onBackground,
  onToggleVideoCutout,
  onRemoveImage,
  onRestoreImage,
  onExtractAudio,
  onDownloadAudio,
  onOpenExport,
  onThreshold,
  onFeather,
  onInvert,
}: {
  asset: MediaAsset | null
  ratio: RatioKey
  fit: FitMode
  background: Background
  videoCutout: boolean
  processing: ProcessingState | null
  videoAiStatus: AiStatus
  threshold: number
  feather: number
  invert: boolean
  outputWidth: number
  outputHeight: number
  formatLabel: string
  onClose: () => void
  onRatio: (ratio: RatioKey) => void
  onFit: (fit: FitMode) => void
  onBackground: (background: Background) => void
  onToggleVideoCutout: (next: boolean) => void
  onRemoveImage: () => void
  onRestoreImage: () => void
  onExtractAudio: (mode?: 'full' | 'voice' | 'background') => void
  onDownloadAudio: () => void
  onOpenExport: () => void
  onThreshold: (value: number) => void
  onFeather: (value: number) => void
  onInvert: (value: boolean) => void
}) {
  const imageBusy =
    asset?.kind === 'image' &&
    processing?.assetId === asset.id &&
    processing.kind === 'image-cutout'
  const audioBusy =
    asset?.kind === 'video' &&
    processing?.assetId === asset.id &&
    processing.kind === 'audio'
  const isGreenBackdrop =
    background.mode === 'color' && isGreen(background.color)

  return (
    <aside className="inspector">
      <div className="inspector-header">
        <div>
          <span className="eyebrow">Properties</span>
          <h2>Design</h2>
        </div>
        <button
          type="button"
          className="icon-button inspector-close"
          onClick={onClose}
          aria-label="Close design settings"
        >
          <X size={16} />
        </button>
      </div>

      <div className="inspector-scroll">
        {asset ? (
          <div className="inspector-section compact-section">
            <AssetDetail asset={asset} />
          </div>
        ) : null}

        <Section
          title="Canvas"
          eyebrow="Format"
          icon={<ImageIcon size={16} />}
        >
          <RatioPicker value={ratio} onChange={onRatio} asset={asset} />
          <div className="fit-row">
            <span>Frame</span>
            <div className="segmented">
              <button
                type="button"
                className={fit === 'contain' ? 'is-active' : ''}
                onClick={() => onFit('contain')}
              >
                Fit
              </button>
              <button
                type="button"
                className={fit === 'cover' ? 'is-active' : ''}
                onClick={() => onFit('cover')}
              >
                Fill
              </button>
            </div>
          </div>
        </Section>

        <Section
          title="Cutout"
          eyebrow="Foreground"
          icon={<WandSparkles size={16} />}
        >
          {!asset ? (
            <div className="mini-empty">
              Upload an image or video to remove its background.
            </div>
          ) : asset.kind === 'video' ? (
            <div className="inspector-cutout">
              <div className="inspector-toggle-row">
                <span>
                  <strong>Live cutout</strong>
                  <small>
                    {videoAiStatus === 'loading'
                      ? 'Loading model…'
                      : videoCutout
                        ? 'Running in real time'
                        : 'Remove the person background'}
                  </small>
                </span>
                {videoAiStatus === 'loading' ? (
                  <Loader2 size={16} className="spin muted-icon" />
                ) : (
                  <Toggle
                    checked={videoCutout}
                    onChange={onToggleVideoCutout}
                    label="Live video cutout"
                  />
                )}
              </div>
              {videoCutout ? (
                <>
                  <div className="thin-divider" />
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
                  <label className="inline-toggle compact">
                    <span>Invert mask</span>
                    <Toggle
                      checked={invert}
                      onChange={onInvert}
                      label="Invert mask"
                    />
                  </label>
                </>
              ) : null}
            </div>
          ) : asset.cutoutStatus === 'done' ? (
            <div className="inspector-success">
              <div className="success-row">
                <span className="success-icon">
                  <CheckCircle2 size={17} />
                </span>
                <div>
                  <strong>Background removed</strong>
                  <span>Transparent PNG cutout is ready.</span>
                </div>
              </div>
              <button type="button" className="ghost-action" onClick={onRestoreImage}>
                <RotateCcw size={14} />
                Restore original
              </button>
            </div>
          ) : (
            <div className="inspector-cutout">
              <button
                type="button"
                className="primary-action wide"
                onClick={onRemoveImage}
                disabled={imageBusy}
              >
                {imageBusy ? (
                  <Loader2 size={15} className="spin" />
                ) : (
                  <Sparkles size={15} />
                )}
                {imageBusy ? 'Removing background…' : 'Remove background'}
              </button>
              {imageBusy ? (
                <div className="cutout-progress compact-progress">
                  <div className="progress-track">
                    <span
                      style={{ width: `${Math.max(4, processing?.progress ?? 0)}%` }}
                    />
                  </div>
                  <div className="progress-copy">
                    <span>{processing?.label}</span>
                    <b>{Math.round(processing?.progress ?? 0)}%</b>
                  </div>
                </div>
              ) : (
                <p className="section-help">
                  Subject-aware matting for people, products, and objects.
                </p>
              )}
            </div>
          )}
        </Section>

        <Section
          title="Backdrop"
          eyebrow="Green screen"
          icon={<Scissors size={16} />}
          action={
            <span className={`status-pill ${isGreenBackdrop ? 'is-green' : ''}`}>
              {background.mode === 'color'
                ? isGreenBackdrop
                  ? 'Chroma'
                  : 'Solid'
                : 'Transparent'}
            </span>
          }
        >
          <BackdropPicker
            background={background}
            onChange={onBackground}
            compact
          />
          {background.mode === 'color' && !isGreen(background.color) ? (
            <button
              type="button"
              className="secondary-action wide chroma-reset"
              onClick={() => onBackground({ mode: 'color', color: '#00B140' })}
            >
              <Sparkles size={14} />
              Reset to chroma green
            </button>
          ) : null}
        </Section>

        {asset?.kind === 'video' ? (
          <Section
            title="Audio"
            eyebrow="Soundtrack"
            icon={<AudioLines size={16} />}
            action={
              asset.audio ? (
                <span className="status-pill is-green">WAV</span>
              ) : undefined
            }
          >
            {asset.audio ? (
              <>
                <AudioPlayer
                  src={asset.audio.url}
                  waveform={asset.audio.waveform}
                  duration={asset.audio.duration}
                  onDownload={onDownloadAudio}
                  compact
                />
                <div className="audio-meta-row">
                  <span>{formatTime(asset.audio.duration)} · 16-bit PCM</span>
                  <button
                    type="button"
                    className="text-button"
                    onClick={onExtractAudio}
                    disabled={audioBusy}
                  >
                    Re-extract
                  </button>
                </div>
              </>
            ) : (
              <div className="inspector-audio">
                <div className="inspector-audio-row">
                  <span className="inspector-audio-icon">
                    <Film size={16} />
                  </span>
                  <div>
                    <strong>Extract soundtrack</strong>
                    <span>Lossless WAV, decoded on-device.</span>
                  </div>
                  <button
                    type="button"
                    className="secondary-action compact"
                    onClick={onExtractAudio}
                    disabled={audioBusy}
                  >
                    {audioBusy ? (
                      <Loader2 size={13} className="spin" />
                    ) : (
                      <Download size={13} />
                    )}
                    {audioBusy ? 'Working' : 'Extract'}
                  </button>
                </div>
                {audioBusy ? (
                  <div className="cutout-progress compact-progress">
                    <div className="progress-track">
                      <span
                        style={{ width: `${Math.max(6, processing?.progress ?? 0)}%` }}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </Section>
        ) : null}

        <div className="inspector-section">
          <PrivacyNote>
            Cutouts, audio, and exports are processed locally. No media is sent
            to a server.
          </PrivacyNote>
        </div>
      </div>

      <div className="inspector-export">
        <div>
          <span>
            {formatLabel} · {outputWidth} × {outputHeight}
          </span>
          <strong>
            {background.mode === 'color'
              ? isGreen(background.color)
                ? 'Green screen'
                : background.color.toUpperCase()
              : 'Transparent'}
          </strong>
        </div>
        <button type="button" className="export-button" onClick={onOpenExport}>
          <Download size={15} />
          Export
        </button>
      </div>
    </aside>
  )
}
