import clsx from 'clsx';
import { Brain, Cpu, ListChecks, Play, Settings2, Sparkles, Tags } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AppInfoResponse, AppSettings } from '@shared/types';
import { api } from '../../lib/bridge';
import { useUi, type AiTab } from '../../lib/store';
import { Button } from '../ui';
import { AiAnalysisView } from './AiAnalysisView';
import { AiModelSettings } from './AiModelSettings';
import { AiOverview } from './AiOverview';
import { AiProfileView } from './AiProfileView';
import { AiQueueView } from './AiQueueView';
import { AiReviewView } from './AiReviewView';
import { AiStartModal } from './AiStartModal';

interface AiTaggingViewProps {
  info: AppInfoResponse | null;
  settings: AppSettings | null;
  onChanged: () => void;
}

const TABS: Array<{ key: AiTab; label: string; icon: React.ReactNode }> = [
  { key: 'overview', label: '概览', icon: <Sparkles size={12} /> },
  { key: 'queue', label: '打标任务', icon: <ListChecks size={12} /> },
  { key: 'review', label: '标签审核', icon: <Tags size={12} /> },
  { key: 'profiles', label: '标签方案', icon: <Settings2 size={12} /> },
  { key: 'models', label: '模型与工具', icon: <Cpu size={12} /> },
  { key: 'analysis', label: '库级分析', icon: <Brain size={12} /> }
];

export function AiTaggingView({ info, settings, onChanged }: AiTaggingViewProps) {
  const aiTab = useUi((state) => state.aiTab);
  const setAiTab = useUi((state) => state.setAiTab);
  const [startOpen, setStartOpen] = useState(false);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    void api.ai.review
      .counts()
      .then((counts) => setPending(counts.pending))
      .catch(() => undefined);
  }, [aiTab]);

  useEffect(
    () =>
      api.ai.review.onChanged(() => {
        void api.ai.review
          .counts()
          .then((counts) => setPending(counts.pending))
          .catch(() => undefined);
      }),
    []
  );

  const openStart = () => setStartOpen(true);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="scroll-thin flex flex-none items-center gap-1 overflow-x-auto border-b border-line2 bg-panel/30 px-3 py-1.5">
        <div role="tablist" aria-label="AI 打标页面" className="flex min-w-0 items-center gap-0.5">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={aiTab === tab.key}
              onClick={() => setAiTab(tab.key)}
              className={clsx(
                'inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11.5px] transition-colors',
                aiTab === tab.key
                  ? 'border-pink/35 bg-pink/10 text-pink'
                  : 'border-transparent text-muted hover:border-line/60 hover:bg-panel2/50 hover:text-fg'
              )}
            >
              {tab.icon}
              {tab.label}
              {tab.key === 'review' && pending > 0 ? (
                <span className="rounded bg-yellow/15 px-1 font-mono text-[9.5px] text-yellow">
                  {pending}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        {info ? (
          <span className="ml-2 hidden shrink-0 font-mono text-[10px] text-dim xl:inline">
            v{info.version}
          </span>
        ) : null}
        <Button variant="primary" size="sm" className="ml-auto shrink-0" onClick={openStart}>
          <Play size={11} />
          开始打标
        </Button>
      </div>

      <div key={aiTab} className="view-fade min-h-0 flex-1">
        {aiTab === 'overview' ? (
          <AiOverview onStart={openStart} onOpenTab={setAiTab} />
        ) : aiTab === 'queue' ? (
          <AiQueueView onStart={openStart} />
        ) : aiTab === 'review' ? (
          <AiReviewView />
        ) : aiTab === 'profiles' ? (
          <AiProfileView />
        ) : aiTab === 'models' ? (
          <AiModelSettings />
        ) : (
          <AiAnalysisView />
        )}
      </div>

      <AiStartModal
        open={startOpen}
        settings={settings}
        onClose={() => setStartOpen(false)}
        onOpenModels={() => {
          setStartOpen(false);
          setAiTab('models');
        }}
        onOpenProfiles={() => {
          setStartOpen(false);
          setAiTab('profiles');
        }}
        onStarted={() => {
          setAiTab('queue');
          onChanged();
        }}
      />
    </div>
  );
}
