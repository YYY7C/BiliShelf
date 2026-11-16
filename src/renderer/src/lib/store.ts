import { create } from 'zustand';
import type { DownloadJob, JobStatusCounts, JobsSnapshot, SortKey, VideoStatus } from '@shared/types';

export type View = 'library' | 'sources' | 'tasks' | 'ai';

export type AiTab = 'overview' | 'queue' | 'review' | 'profiles' | 'models' | 'analysis';

export interface Filters {
  search: string;
  tag: string | null;
  aiTag: string | null;
  folder: string | null;
  status: VideoStatus | 'all';
  sourceId: number | null;
  sort: SortKey;
}

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'warn' | 'error';
  message: string;
}

interface UiState {
  view: View;
  filters: Filters;
  selectedId: number | null;
  selection: number[];
  inspectorOpen: boolean;
  settingsOpen: boolean;
  playerId: number | null;
  libraryVersion: number;
  sourcesVersion: number;
  jobs: DownloadJob[];
  jobsTotal: number;
  jobCounts: JobStatusCounts;
  toasts: Toast[];
  aiTab: AiTab;
  aiReviewVideoId: number | null;

  setView: (view: View) => void;
  patchFilters: (patch: Partial<Filters>) => void;
  resetFilters: () => void;
  select: (id: number | null) => void;
  setAiTab: (tab: AiTab) => void;
  openAiReview: (videoId?: number | null) => void;
  toggleSelect: (id: number, additive: boolean) => void;
  setSelection: (ids: number[]) => void;
  clearSelection: () => void;
  setInspectorOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  openPlayer: (id: number) => void;
  closePlayer: () => void;
  bumpLibrary: () => void;
  bumpSources: () => void;
  setJobsSnapshot: (snapshot: JobsSnapshot) => void;
  pushToast: (kind: Toast['kind'], message: string) => void;
  dismissToast: (id: number) => void;
}

const defaultFilters: Filters = {
  search: '',
  tag: null,
  aiTag: null,
  folder: null,
  status: 'present',
  sourceId: null,
  sort: 'added'
};

let toastSeq = 1;

export const useUi = create<UiState>((set, get) => ({
  view: 'library',
  filters: { ...defaultFilters },
  selectedId: null,
  selection: [],
  inspectorOpen: true,
  settingsOpen: false,
  playerId: null,
  libraryVersion: 0,
  sourcesVersion: 0,
  jobs: [],
  jobsTotal: 0,
  jobCounts: { active: 0, pausable: 0, queued: 0, paused: 0 },
  toasts: [],
  aiTab: 'overview',
  aiReviewVideoId: null,

  setView: (view) => set({ view }),
  patchFilters: (patch) =>
    set((state) => ({
      filters: { ...state.filters, ...patch },
      selection: []
    })),
  resetFilters: () => set({ filters: { ...defaultFilters }, selection: [] }),
  select: (id) => set({ selectedId: id, inspectorOpen: id !== null ? true : get().inspectorOpen }),
  setAiTab: (tab) => set({ aiTab: tab }),
  openAiReview: (videoId) => set({ view: 'ai', aiTab: 'review', aiReviewVideoId: videoId ?? null }),
  toggleSelect: (id, additive) =>
    set((state) => {
      if (!additive) return { selection: [id], selectedId: id };
      const exists = state.selection.includes(id);
      return {
        selection: exists ? state.selection.filter((item) => item !== id) : [...state.selection, id],
        selectedId: id
      };
    }),
  setSelection: (ids) => set({ selection: ids }),
  clearSelection: () => set({ selection: [] }),
  setInspectorOpen: (open) => set({ inspectorOpen: open }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  openPlayer: (id) => set({ playerId: id }),
  closePlayer: () => set({ playerId: null }),
  bumpLibrary: () => set((state) => ({ libraryVersion: state.libraryVersion + 1 })),
  bumpSources: () => set((state) => ({ sourcesVersion: state.sourcesVersion + 1 })),
  setJobsSnapshot: (snapshot) =>
    set({ jobs: snapshot.items, jobsTotal: snapshot.total, jobCounts: snapshot.counts }),
  pushToast: (kind, message) =>
    set((state) => ({
      toasts: [...state.toasts.slice(-3), { id: toastSeq++, kind, message }]
    })),
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }))
}));
