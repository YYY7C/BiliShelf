import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Download, Loader2 } from 'lucide-react';
import type { QualityScanProgress, QualityScanResult } from '@shared/types';
import { api } from '../lib/bridge';
import { useUi } from '../lib/store';
import { Button, Modal, Spinner, Tag } from './ui';

function formatHeight(height: number | null): string {
  if (!height) return '—';
  if (height >= 2160) return '4K';
  if (height >= 1440) return '2K';
  return `${height}P`;
}

function formatBitrate(bps: number | null): string {
  if (!bps) return '—';
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`;
  return `${Math.round(bps / 1000)} kbps`;
}

export function QualityUpgradeModal({ loggedIn, onClose }: { loggedIn: boolean; onClose: () => void }) {
  const pushToast = useUi((state) => state.pushToast);
  const [scanning, setScanning] = useState(true);
  const [progress, setProgress] = useState<QualityScanProgress | null>(null);
  const [result, setResult] = useState<QualityScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [enqueueing, setEnqueueing] = useState(false);
  const startedRef = useRef(false);

  const runScan = useCallback(async () => {
    setScanning(true);
    setError(null);
    setResult(null);
    setProgress(null);
    setSelected([]);
    try {
      const next = await api.quality.scan();
      setResult(next);
      setSelected(next.candidates.map((candidate) => candidate.videoId));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    const off = api.quality.onProgress((next) => setProgress(next));
    if (!startedRef.current) {
      startedRef.current = true;
      void runScan();
    }
    return off;
  }, [runScan]);

  const candidates = useMemo(() => result?.candidates ?? [], [result]);
  const allSelected = candidates.length > 0 && selected.length === candidates.length;

  const toggle = (videoId: number) => {
    setSelected((current) =>
      current.includes(videoId) ? current.filter((id) => id !== videoId) : [...current, videoId]
    );
  };

  const toggleAll = () => {
    setSelected(allSelected ? [] : candidates.map((candidate) => candidate.videoId));
  };

  const enqueue = async () => {
    if (selected.length === 0) return;
    setEnqueueing(true);
    try {
      const next = await api.quality.enqueue(selected);
      pushToast(
        next.queued > 0 ? 'success' : 'info',
        `已加入 ${next.queued} 个画质升级任务，跳过 ${next.skipped} 个`
      );
      onClose();
    } catch (err) {
      pushToast('error', (err as Error).message);
    } finally {
      setEnqueueing(false);
    }
  };

  return (
    <Modal
      title="检查画质升级"
      subtitle="用最高画质重新下载并替换旧文件；标签、文件夹、备注会保留"
      onClose={onClose}
      width="max-w-2xl"
    >
      {!loggedIn ? (
        <div className="mb-3 rounded-lg border border-yellow/30 bg-yellow/[0.07] px-3 py-2 text-[11px] leading-5 text-yellow">
          未登录时只能探测到较低画质，建议先在设置中登录 B 站再检查。
        </div>
      ) : null}
      {scanning ? (
        <div className="flex flex-col items-center gap-3 py-10">
          <Spinner />
          <div className="text-[12.5px] text-fg">正在检查已下载视频的画质…</div>
          <div className="max-w-md truncate text-[11px] text-dim">
            {progress ? `${progress.scanned}/${progress.total} · ${progress.title}` : '准备中'}
          </div>
          {progress ? (
            <div className="h-1 w-full max-w-sm overflow-hidden rounded bg-panel3">
              <div
                className="h-full bg-pink transition-all"
                style={{ width: `${(progress.scanned / Math.max(progress.total, 1)) * 100}%` }}
              />
            </div>
          ) : null}
          <div className="text-[11px] text-dim">逐个视频探测，可能需要几十秒到几分钟</div>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <AlertTriangle size={22} className="text-red" />
          <div className="max-w-md text-[12.5px] text-fg">{error}</div>
          <Button variant="subtle" size="sm" onClick={() => void runScan()}>
            重试
          </Button>
        </div>
      ) : result ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-dim">
            <span>已扫描 {result.scanned} 个</span>
            <span>·</span>
            <span className="text-green">{result.candidates.length} 个可升级</span>
            {result.failed > 0 ? (
              <>
                <span>·</span>
                <span className="text-red">{result.failed} 个探测失败</span>
              </>
            ) : null}
            {result.remaining > 0 ? (
              <>
                <span>·</span>
                <span>还有 {result.remaining} 个未检查</span>
                <button
                  type="button"
                  onClick={() => void runScan()}
                  className="rounded border border-line px-1.5 py-0.5 text-[10.5px] text-muted transition-colors hover:text-fg"
                >
                  继续检查
                </button>
              </>
            ) : null}
            {result.failed > 0 ? (
              <span className="text-dim">（失败项下次扫描会重试）</span>
            ) : null}
          </div>

          {candidates.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <CheckCircle2 size={24} className="text-green" />
              <div className="text-[12.5px] text-fg">所有已下载视频都已是当前最高画质</div>
              <div className="text-[11px] text-dim">没有发现分辨率或码率更高的版本</div>
            </div>
          ) : (
            <>
              <div className="scroll-thin max-h-[46vh] space-y-2 overflow-y-auto pr-1">
                {candidates.map((candidate) => {
                  const checked = selected.includes(candidate.videoId);
                  return (
                    <div
                      key={candidate.videoId}
                      role="button"
                      tabIndex={0}
                      onClick={() => toggle(candidate.videoId)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          toggle(candidate.videoId);
                        }
                      }}
                      className="flex cursor-pointer items-start gap-3 rounded-lg border border-line2 bg-panel2/40 px-3 py-2.5 transition-colors hover:bg-panel2/70"
                    >
                      <span
                        className={
                          checked
                            ? 'mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded border border-pink bg-pink text-white'
                            : 'mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded border border-line text-transparent'
                        }
                      >
                        <CheckCircle2 size={10} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12.5px] text-fg" title={candidate.title}>
                          {candidate.title}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                          <span className="font-mono text-dim">
                            {formatHeight(candidate.currentHeight)} · {formatBitrate(candidate.currentBitrate)}
                          </span>
                          <ArrowRight size={11} className="text-dim" />
                          <span className="font-mono text-green">
                            {formatHeight(candidate.availableHeight)} · {formatBitrate(candidate.availableBitrate)}
                          </span>
                          <Tag tone={candidate.reason === 'resolution' ? 'blue' : 'yellow'}>
                            {candidate.reason === 'resolution' ? '分辨率升级' : '码率升级'}
                          </Tag>
                          {candidate.sourceName ? (
                            <span className="truncate text-dim">{candidate.sourceName}</span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-line2 pt-3">
                <button
                  type="button"
                  onClick={toggleAll}
                  className="text-[11.5px] text-dim transition-colors hover:text-fg"
                >
                  {allSelected ? '取消全选' : '全选'}
                </button>
                <span className="text-[11px] text-dim">已选 {selected.length} 个</span>
                <div className="ml-auto flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={onClose} disabled={enqueueing}>
                    关闭
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => void enqueue()}
                    disabled={selected.length === 0 || enqueueing}
                  >
                    {enqueueing ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                    加入升级队列
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      ) : null}
    </Modal>
  );
}
