import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** 防止单个组件异常导致整窗空白；给出可恢复的错误界面。 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ui] render error', error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-ink px-8 text-center">
        <div className="text-[15px] font-semibold text-fg">界面出现了一个错误</div>
        <p className="max-w-lg text-[12px] leading-5 text-muted">{error.message}</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="rounded-lg border border-line bg-panel2 px-3 py-1.5 text-[12px] text-fg hover:bg-panel3"
          >
            重试渲染
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg border border-pink/40 bg-pink/90 px-3 py-1.5 text-[12px] font-medium text-white"
          >
            重新加载
          </button>
        </div>
        <p className="max-w-lg text-[11px] leading-4 text-dim">
          如果问题持续，请到「设置 → 打开日志目录」查看日志；素材库数据不会因此丢失。
        </p>
      </div>
    );
  }
}
