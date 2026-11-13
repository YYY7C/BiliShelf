// ==UserScript==
// @name         Bilibili 动态短视频过滤 + 快速收藏
// @namespace    bdvf.local
// @version      1.3.0
// @description  在 B 站动态页（t.bilibili.com，含「视频」标签页）隐藏时长小于 N 秒的视频动态；为每条视频动态注入「收藏」按钮，点击即弹出收藏夹选择框，无需进入视频页即可收藏（支持多选收藏夹、新建收藏夹、取消收藏）；鼠标悬停视频卡片时自动放大并播放预览，放大程度可在面板中调节（100% ~ 130%）；一键下载视频（默认 1080P，画质可在面板配置，支持纯音频 m4a），使用 Mediabunny 在浏览器内自动合并音视频，无需 ffmpeg。
// @match        https://t.bilibili.com/*
// @icon         https://www.bilibili.com/favicon.ico
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @license      MIT
// ==/UserScript==

/*
 * 使用说明
 * ──────────────────────────────────────────────────────────
 * 1) 过滤：页面右下角有配置面板（可折叠）。
 *    - 「启用过滤」开关：一键开关。
 *    - 滑块 / 输入框：设置阈值 N（秒）。
 *    - 时长 < N 秒的视频动态会被隐藏；调小 N 会立即恢复显示。
 *    - 配置会持久保存，刷新后依然生效。
 *
 * 2) 快速收藏：每条视频动态底部操作栏（转发/评论/点赞之后）
 *    多出一个「收藏」按钮，点击弹出收藏夹列表：
 *    - 勾选 / 取消勾选收藏夹（多选）；
 *    - 支持「＋ 新建收藏夹」；
 *    - 点「完成」提交，已收藏的显示「已收藏」金色状态。
 *    - 全程不跳转视频页。
 *
 * 3) 悬停预览：鼠标停留在视频卡片上约 0.3 秒，卡片会轻微放大
 *    并自动播放视频画面（静音循环），移开即停；点击卡片照常
 *    跳转视频页。可在右下角面板中开关此功能，并用「放大」滑块
 *    调节放大程度（100% ~ 130%，默认 106%）。
 *
 * 4) 视频下载：视频卡片操作栏有「下载」按钮，一键下载当前
 *    画质配置的视频（音视频自动合并为 MP4，无需 ffmpeg）。
 *    - 默认 1080P；可用右下角面板的「下载画质」切换：
 *      1080P+ / 1080P / 720P / 480P / 360P / 仅音频 (m4a)。
 *    - 若所选画质不可用（如未登录/无权限），自动降级到
 *      可用的最高画质并提示。
 *    - 合并依赖 Mediabunny 组件（首次使用时自动从 CDN 加载）。
 * ──────────────────────────────────────────────────────────
 * 说明：动态页本身没有可复用的官方收藏弹窗组件，
 *       因此收藏框使用官方收藏 API + 仿官方样式实现，
 *       交互流程（选择收藏夹 → 完成）与播放页一致。
 */

(() => {
  'use strict';

  if (window.top !== window.self) return; // 仅顶层页面运行（@noframes 之外的兜底）

  /* ======================= 存储 & 配置 ======================= */

  const LS_PREFIX = 'bdvf_';
  const KEY_MIN_SEC = 'minSec';
  const KEY_ENABLED = 'enabled';
  const KEY_PREVIEW = 'previewEnabled';
  const KEY_ZOOM = 'zoomPct';
  const KEY_DL_QN = 'dlQn';
  const DEFAULT_MIN_SEC = 60;
  const DEFAULT_ZOOM_PCT = 106;
  const DEFAULT_DL_QN = 80;

  function storeGet(key, def) {
    try {
      if (typeof GM_getValue === 'function') return GM_getValue(key, def);
      const raw = localStorage.getItem(LS_PREFIX + key);
      return raw === null ? def : JSON.parse(raw);
    } catch (e) {
      return def;
    }
  }

  function storeSet(key, val) {
    try {
      if (typeof GM_setValue === 'function') { GM_setValue(key, val); return; }
      localStorage.setItem(LS_PREFIX + key, JSON.stringify(val));
    } catch (e) { /* ignore */ }
  }

  let minSec = Math.max(0, Number(storeGet(KEY_MIN_SEC, DEFAULT_MIN_SEC)) || 0);
  let enabled = storeGet(KEY_ENABLED, true) !== false;

  /* ======================= 通用工具 ======================= */

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  /** '02:41' / '1:02:41' -> 秒数；解析失败返回 null */
  function parseDurationText(text) {
    const s = String(text || '').trim();
    if (!s) return null;
    const parts = s.split(':');
    if (parts.length < 2 || parts.length > 3) return null;
    let sec = 0;
    for (const p of parts) {
      if (!/^\d{1,3}$/.test(p)) return null;
      sec = sec * 60 + parseInt(p, 10);
    }
    return sec;
  }

  function getCookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  }

  async function httpGet(url) {
    const resp = await fetch(url, { credentials: 'include' });
    return resp.json();
  }

  async function httpPost(url, data) {
    const resp = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(data).toString()
    });
    return resp.json();
  }

  /* ======================= 样式 ======================= */

  const CSS = `
    /* ---- 过滤 ---- */
    .bdvf-hide { display: none !important; }

    /* ---- 快速收藏按钮 ---- */
    .bdvf-fav-wrap { display: inline-flex; }
    .bdvf-fav-btn {
      display: inline-flex; align-items: center; gap: 4px;
      cursor: pointer; user-select: none; white-space: nowrap;
    }
    .bdvf-fav-btn svg {
      width: 18px; height: 18px; flex: none;
      fill: none; stroke: currentColor; stroke-width: 1.3; stroke-linejoin: round;
      transition: transform .12s ease;
    }
    .bdvf-fav-btn:hover { color: #00AEEC; }
    .bdvf-fav-btn:hover svg { transform: scale(1.12); }
    .bdvf-fav-btn.bdvf-on { color: #FFB027; }
    .bdvf-fav-btn.bdvf-on svg { fill: currentColor; }
    .bdvf-fav-btn__text { font-size: 13px; line-height: 1; }

    /* ---- 下载按钮 ---- */
    .bdvf-dl-btn {
      display: inline-flex; align-items: center; gap: 4px;
      cursor: pointer; user-select: none; white-space: nowrap;
    }
    .bdvf-dl-btn svg {
      width: 18px; height: 18px; flex: none;
      fill: none; stroke: currentColor; stroke-width: 1.3;
      stroke-linecap: round; stroke-linejoin: round;
      transition: transform .12s ease;
    }
    .bdvf-dl-btn:hover { color: #00AEEC; }
    .bdvf-dl-btn:hover svg { transform: translateY(1px); }
    .bdvf-dl-btn.bdvf-busy { color: #00AEEC; pointer-events: none; }
    .bdvf-dl-btn.bdvf-done { color: #2AC864; }
    .bdvf-dl-btn__text { font-size: 13px; line-height: 1; }
    .bdvf-select {
      flex: 1; min-width: 0; border: 1px solid #e3e5e7; border-radius: 6px;
      padding: 2px 4px; font-size: 13px; color: inherit; background: #fff;
      font-family: inherit; outline: none; cursor: pointer;
    }
    .bdvf-select:focus { border-color: #00AEEC; }

    /* ---- 悬停预览 ---- */
    a.bili-dyn-card-video { transition: transform .22s ease, box-shadow .22s ease; }
    a.bili-dyn-card-video.bdvf-previewing {
      transform: scale(var(--bdvf-zoom, 1.06));
      transform-origin: left center;
      box-shadow: 0 6px 24px rgba(0, 0, 0, .18);
      position: relative;
      z-index: 20;
    }
    .bdvf-preview-video {
      position: absolute; inset: 0; z-index: 5;
      width: 100%; height: 100%; object-fit: cover;
      border-radius: inherit; background: #000;
      opacity: 0; transition: opacity .18s ease;
      pointer-events: none;
    }
    .bdvf-preview-video--show { opacity: 1; }

    /* ---- 收藏夹弹窗 ---- */
    .bdvf-mask {
      position: fixed; inset: 0; z-index: 2147483000;
      background: rgba(0, 0, 0, .45);
      display: flex; align-items: center; justify-content: center;
    }
    .bdvf-dialog {
      width: 420px; max-width: calc(100vw - 32px); max-height: 78vh;
      background: #fff; border-radius: 8px; color: #18191c;
      box-shadow: 0 12px 40px rgba(0, 0, 0, .18);
      display: flex; flex-direction: column; overflow: hidden;
      font-size: 14px; line-height: 1.4;
      animation: bdvf-pop .16s ease-out;
    }
    @keyframes bdvf-pop {
      from { opacity: 0; transform: scale(.96); }
      to   { opacity: 1; transform: scale(1); }
    }
    .bdvf-dialog__header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 14px 20px; font-size: 16px; font-weight: 500;
      border-bottom: 1px solid #f1f2f3; flex: none;
    }
    .bdvf-dialog__close {
      cursor: pointer; color: #9499a0; font-size: 20px; line-height: 1;
      padding: 0 2px; user-select: none;
    }
    .bdvf-dialog__close:hover { color: #18191c; }
    .bdvf-dialog__list { overflow-y: auto; padding: 6px 0; flex: 1 1 auto; }
    .bdvf-folder {
      display: flex; align-items: center; gap: 10px;
      padding: 9px 20px; cursor: pointer;
    }
    .bdvf-folder:hover { background: #f6f7f8; }
    .bdvf-folder input[type="checkbox"] {
      width: 16px; height: 16px; margin: 0; flex: none;
      accent-color: #00AEEC; cursor: pointer;
    }
    .bdvf-folder__name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bdvf-folder__count { color: #9499a0; font-size: 12px; flex: none; }
    .bdvf-new { padding: 9px 20px; color: #00AEEC; cursor: pointer; }
    .bdvf-new:hover { background: #f6f7f8; }
    .bdvf-new-box { display: flex; gap: 8px; padding: 8px 20px; }
    .bdvf-new-input {
      flex: 1; min-width: 0; border: 1px solid #e3e5e7; border-radius: 6px;
      padding: 4px 8px; font-size: 13px; color: inherit; outline: none;
      font-family: inherit;
    }
    .bdvf-new-input:focus { border-color: #00AEEC; }
    .bdvf-tip { padding: 12px 20px; color: #9499a0; font-size: 13px; }
    .bdvf-tip--err { color: #ff4757; }
    .bdvf-dialog__footer {
      display: flex; justify-content: flex-end; gap: 10px;
      padding: 12px 20px; border-top: 1px solid #f1f2f3; flex: none;
    }
    .bdvf-btn {
      font-size: 14px; padding: 7px 22px; border-radius: 6px; border: none;
      cursor: pointer; font-family: inherit; line-height: 1.2;
    }
    .bdvf-btn--cancel { background: #f1f2f3; color: #18191c; }
    .bdvf-btn--cancel:hover { background: #e3e5e7; }
    .bdvf-btn--ok { background: #00AEEC; color: #fff; }
    .bdvf-btn--ok:hover { background: #00a1d6; }
    .bdvf-btn--ok:disabled { opacity: .5; cursor: not-allowed; }
    .bdvf-btn--mini { padding: 4px 12px; font-size: 13px; background: #00AEEC; color: #fff; }
    .bdvf-btn--mini:hover { background: #00a1d6; }
    .bdvf-btn--mini:disabled { opacity: .5; cursor: not-allowed; }

    /* ---- 右下角设置面板 ---- */
    .bdvf-panel {
      position: fixed; right: 16px; bottom: 16px; z-index: 2147482000;
      width: 226px; background: #fff; color: #18191c;
      border-radius: 10px; overflow: hidden;
      box-shadow: 0 2px 16px rgba(0, 0, 0, .16);
      font-size: 13px; line-height: 1.4;
    }
    .bdvf-panel__head {
      display: flex; justify-content: space-between; align-items: center;
      padding: 8px 12px; background: #f6f7f8; cursor: pointer;
      font-weight: 500; user-select: none;
    }
    .bdvf-panel__fold { color: #9499a0; width: 14px; text-align: center; }
    .bdvf-panel__body { padding: 10px 12px 12px; }
    .bdvf-panel--collapsed .bdvf-panel__body { display: none; }
    .bdvf-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .bdvf-row--check { cursor: pointer; user-select: none; }
    .bdvf-row--num { white-space: nowrap; }
    .bdvf-range { flex: 1; margin: 0; accent-color: #00AEEC; }
    .bdvf-num {
      width: 64px; box-sizing: border-box; border: 1px solid #e3e5e7;
      border-radius: 6px; padding: 3px 6px; font-size: 13px; color: inherit;
      outline: none; font-family: inherit;
    }
    .bdvf-num:focus { border-color: #00AEEC; }
    .bdvf-enable { accent-color: #00AEEC; margin: 0; }
    .bdvf-stat { color: #9499a0; font-size: 12px; margin-top: 4px; }
    .bdvf-zoom-val { min-width: 40px; text-align: right; color: #9499a0; font-size: 12px; flex: none; }

    /* ---- Toast ---- */
    .bdvf-toast {
      position: fixed; left: 50%; bottom: 76px; z-index: 2147483100;
      transform: translate(-50%, 12px);
      background: rgba(24, 25, 28, .92); color: #fff;
      font-size: 13px; padding: 8px 18px; border-radius: 8px;
      opacity: 0; pointer-events: none; transition: opacity .2s ease, transform .2s ease;
      max-width: 70vw;
    }
    .bdvf-toast--show { opacity: 1; transform: translate(-50%, 0); }
    .bdvf-toast--err { background: rgba(255, 71, 87, .95); }
  `;

  function injectCSS(css) {
    if (typeof GM_addStyle === 'function') { GM_addStyle(css); return; }
    const el = document.createElement('style');
    el.textContent = css;
    (document.head || document.documentElement).appendChild(el);
  }

  /* ======================= Toast ======================= */

  let toastEl = null;
  let toastTimer = 0;

  function toast(msg, ok) {
    if (!toastEl || !toastEl.isConnected) {
      toastEl = document.createElement('div');
      toastEl.className = 'bdvf-toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.toggle('bdvf-toast--err', ok === false);
    // 强制重排后再加 show，保证连续 toast 也能触发动画
    void toastEl.offsetHeight;
    toastEl.classList.add('bdvf-toast--show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('bdvf-toast--show'), 2200);
  }

  /* ======================= 过滤核心 ======================= */

  const HIDE_CLASS = 'bdvf-hide';
  const STAR_SVG = '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M9 1.9 L11.05 6.05 L15.65 6.7 L12.32 9.94 L13.11 14.5 L9 12.4 L4.89 14.5 L5.68 9.94 L2.35 6.7 L6.95 6.05 Z"/></svg>';

  let stats = { hidden: 0, total: 0 };

  /** 收集一条动态的视频信息：{ bvid, minDur }，非视频动态返回 null */
  function collectItemInfo(item) {
    const cards = $$('a.bili-dyn-card-video', item);
    if (!cards.length) return null;

    const bvids = [];
    const durs = [];

    for (const card of cards) {
      const m = (card.getAttribute('href') || '').match(/\/(BV[0-9A-Za-z]{10})/);
      if (m) bvids.push(m[1]);

      let sec = null;
      const dtEl = $('.duration-time', card);
      if (dtEl) sec = parseDurationText(dtEl.textContent);
      if (sec == null) {
        // 兜底：封面阴影区整体文本
        const shadow = $('.bili-dyn-card-video__cover-shadow', card);
        if (shadow) sec = parseDurationText(shadow.textContent);
      }
      if (sec != null) durs.push(sec);
    }

    return {
      bvid: bvids[0] || null,
      minDur: durs.length ? Math.min.apply(null, durs) : null
    };
  }

  /** 全量扫描：隐藏 + 注入按钮（幂等，可反复调用） */
  function scanFeed() {
    // 卡片被重建/移除时，结束可能残留的预览状态
    if (previewCard && !previewCard.isConnected) stopPreview();

    const items = $$('.bili-dyn-list__item');
    let hidden = 0;
    let total = 0;

    for (const item of items) {
      const info = collectItemInfo(item);
      if (!info) {
        if (item.classList.contains(HIDE_CLASS)) item.classList.remove(HIDE_CLASS);
        continue;
      }
      total++;

      // 1) 注入/更新收藏 + 下载按钮
      if (info.bvid) {
        injectFavButton(item, info.bvid);
        injectDlButton(item, info.bvid);
      }

      // 2) 隐藏判断
      const shouldHide = enabled && info.minDur != null && info.minDur < minSec;
      if (shouldHide !== item.classList.contains(HIDE_CLASS)) {
        item.classList.toggle(HIDE_CLASS, shouldHide);
      }
      if (shouldHide) {
        hidden++;
        // 正在预览的卡片被隐藏时立即停止
        if (previewCard && item.contains(previewCard)) stopPreview();
      }
    }

    stats = { hidden, total };
    renderStats();
  }

  let scanTimer = 0;
  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scanFeed, 250);
  }

  /* ======================= 快速收藏按钮 ======================= */

  const favStateMap = new Map(); // bvid -> boolean（本会话已知的收藏状态）

  function injectFavButton(item, bvid) {
    const footer = $('.bili-dyn-item__footer', item);
    if (!footer) return;

    let btn = $('.bdvf-fav-btn', footer);

    if (!btn) {
      const wrap = document.createElement('div');
      wrap.className = 'bili-dyn-item__action bdvf-fav-wrap';

      btn = document.createElement('div');
      btn.className = 'bili-dyn-action bdvf-fav-btn';
      btn.title = '快速收藏（不用点进视频）';
      btn.innerHTML = STAR_SVG + '<span class="bdvf-fav-btn__text">收藏</span>';
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        openFavDialog(bvid);
      });

      wrap.appendChild(btn);
      footer.appendChild(wrap);
    }

    refreshBtnState(btn, bvid);
  }

  function refreshBtnState(btn, bvid) {
    if (!btn) return;
    if (btn.dataset.bvid !== bvid) btn.dataset.bvid = bvid;

    const on = favStateMap.get(bvid) === true;
    if (on !== btn.classList.contains('bdvf-on')) btn.classList.toggle('bdvf-on', on);

    const textEl = $('.bdvf-fav-btn__text', btn);
    if (textEl) {
      const want = on ? '已收藏' : '收藏';
      if (textEl.textContent !== want) textEl.textContent = want;
    }
  }

  function refreshAllBtnStates() {
    for (const btn of $$('.bdvf-fav-btn')) {
      const bvid = btn.dataset.bvid;
      if (bvid) refreshBtnState(btn, bvid);
    }
  }

  /* ======================= 收藏夹弹窗 ======================= */

  let dialogEl = null;

  function closeDialog() {
    if (dialogEl) {
      dialogEl.remove();
      dialogEl = null;
      document.removeEventListener('keydown', onDialogKeydown, true);
    }
  }

  function onDialogKeydown(ev) {
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      closeDialog();
    }
  }

  function openFavDialog(bvid) {
    if (dialogEl) return; // 已有弹窗

    const jct = getCookie('bili_jct');
    const mid = getCookie('DedeUserID');

    if (!jct || !mid) { toast('请先登录 B 站账号', false); return; }

    dialogEl = document.createElement('div');
    dialogEl.className = 'bdvf-mask';
    dialogEl.innerHTML = `
      <div class="bdvf-dialog" role="dialog" aria-label="选择收藏夹">
        <div class="bdvf-dialog__header">
          <span>选择收藏夹</span>
          <span class="bdvf-dialog__close" title="关闭">×</span>
        </div>
        <div class="bdvf-dialog__list"><div class="bdvf-tip">加载中…</div></div>
        <div class="bdvf-dialog__footer">
          <button type="button" class="bdvf-btn bdvf-btn--cancel">取消</button>
          <button type="button" class="bdvf-btn bdvf-btn--ok" disabled>完成</button>
        </div>
      </div>`;
    document.body.appendChild(dialogEl);
    document.addEventListener('keydown', onDialogKeydown, true);

    const listEl = $('.bdvf-dialog__list', dialogEl);
    const okBtn = $('.bdvf-btn--ok', dialogEl);

    /* ---- 事件 ---- */
    $('.bdvf-dialog__close', dialogEl).addEventListener('click', closeDialog);
    $('.bdvf-btn--cancel', dialogEl).addEventListener('click', closeDialog);
    dialogEl.addEventListener('click', (ev) => { if (ev.target === dialogEl) closeDialog(); });

    /* ---- 解析 aid（新版 bvid 号段的 aid 是大数，只能用官方接口换算） ---- */
    let aidCache = 0;
    async function resolveAid() {
      if (aidCache) return aidCache;
      const view = await httpGet('https://api.bilibili.com/x/web-interface/view?bvid=' + encodeURIComponent(bvid));
      if (!view || view.code !== 0 || !view.data || !view.data.aid) {
        throw new Error((view && view.message) || '无法解析视频 aid');
      }
      aidCache = view.data.aid;
      return aidCache;
    }

    /* ---- 加载收藏夹列表 ---- */
    async function loadAndRender(preselectFid) {
      listEl.innerHTML = '<div class="bdvf-tip">加载中…</div>';
      let folders;
      try {
        const aid = await resolveAid();
        const j = await httpGet(
          'https://api.bilibili.com/x/v3/fav/folder/created/list-all' +
          `?up_mid=${encodeURIComponent(mid)}&rid=${aid}&type=2`
        );
        if (!j || j.code !== 0) throw new Error((j && j.message) || ('接口错误 ' + (j && j.code)));
        folders = (j.data && j.data.list) || [];
      } catch (err) {
        const tip = document.createElement('div');
        tip.className = 'bdvf-tip bdvf-tip--err';
        tip.textContent = '收藏夹加载失败：' + ((err && err.message) || err);
        listEl.innerHTML = '';
        listEl.appendChild(tip);
        return;
      }
      renderFolders(folders, preselectFid);
    }

    function renderFolders(folders, preselectFid) {
      listEl.innerHTML = '';

      if (!folders.length) {
        const tip = document.createElement('div');
        tip.className = 'bdvf-tip';
        tip.textContent = '还没有收藏夹，先新建一个吧';
        listEl.appendChild(tip);
      }

      for (const f of folders) {
        const fid = String(f.id || f.fid);
        const row = document.createElement('label');
        row.className = 'bdvf-folder';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.dataset.fid = fid;
        cb.dataset.was = f.fav_state ? '1' : '0';
        cb.checked = !!f.fav_state || (preselectFid != null && String(preselectFid) === fid);
        row.appendChild(cb);

        const name = document.createElement('span');
        name.className = 'bdvf-folder__name';
        name.textContent = f.title || '(未命名)';
        name.title = f.title || '';
        row.appendChild(name);

        const cnt = document.createElement('span');
        cnt.className = 'bdvf-folder__count';
        cnt.textContent = (f.media_count || 0) + ' 内容';
        row.appendChild(cnt);

        listEl.appendChild(row);
      }

      const newRow = document.createElement('div');
      newRow.className = 'bdvf-new';
      newRow.textContent = '＋ 新建收藏夹';
      newRow.addEventListener('click', () => showCreateFolder(newRow));
      listEl.appendChild(newRow);

      okBtn.disabled = false;
    }

    function showCreateFolder(anchor) {
      if ($('.bdvf-new-box', listEl)) return;

      const box = document.createElement('div');
      box.className = 'bdvf-new-box';
      box.innerHTML =
        '<input class="bdvf-new-input" type="text" maxlength="20" placeholder="收藏夹名称，回车创建">' +
        '<button type="button" class="bdvf-btn bdvf-btn--mini">创建</button>';
      listEl.insertBefore(box, anchor);

      const input = $('.bdvf-new-input', box);
      const btn = $('button', box);
      input.focus();

      const doCreate = async () => {
        const title = input.value.trim();
        if (!title) { input.focus(); return; }
        btn.disabled = true;
        try {
          const j = await httpPost('https://api.bilibili.com/x/v3/fav/folder/add', {
            title, privacy: 0, csrf: jct
          });
          if (!j || j.code !== 0) throw new Error((j && j.message) || '创建失败');
          const fid = j.data && (j.data.id || j.data.fid);
          await loadAndRender(fid); // 重新加载并自动勾选新收藏夹
          toast('收藏夹「' + title + '」已创建');
        } catch (err) {
          btn.disabled = false;
          input.placeholder = '创建失败：' + ((err && err.message) || err);
          input.value = '';
          input.focus();
        }
      };

      btn.addEventListener('click', doCreate);
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); doCreate(); }
      });
    }

    /* ---- 提交 ---- */
    okBtn.addEventListener('click', async () => {
      const boxes = $$('input[type="checkbox"]', listEl);
      const add = [];
      const del = [];

      for (const cb of boxes) {
        const fid = cb.dataset.fid;
        if (cb.checked && cb.dataset.was !== '1') add.push(fid);
        if (!cb.checked && cb.dataset.was === '1') del.push(fid);
      }

      const anyChecked = boxes.some((cb) => cb.checked);

      // 没有变化：只同步状态
      if (!add.length && !del.length) {
        favStateMap.set(bvid, anyChecked);
        refreshAllBtnStates();
        closeDialog();
        return;
      }

      okBtn.disabled = true;
      try {
        const j = await httpPost('https://api.bilibili.com/x/v3/fav/resource/deal', {
          rid: aidCache,
          type: 2,
          add_media_ids: add.join(','),
          del_media_ids: del.join(','),
          platform: 'web',
          csrf: jct
        });
        if (!j || j.code !== 0) throw new Error((j && j.message) || ('操作失败 ' + (j && j.code)));

        favStateMap.set(bvid, anyChecked);
        refreshAllBtnStates();
        toast(anyChecked ? '收藏成功' : '已取消收藏');
        closeDialog();
      } catch (err) {
        okBtn.disabled = false;
        toast('操作失败：' + ((err && err.message) || err), false);
      }
    });

    /* ---- 启动加载 ---- */
    loadAndRender();
  }

  /* ======================= 悬停预览播放 ======================= */

  let previewEnabled = storeGet(KEY_PREVIEW, true) !== false;
  let zoomPct = clampZoom(storeGet(KEY_ZOOM, DEFAULT_ZOOM_PCT));

  /** 放大百分比限制在 100% ~ 130% */
  function clampZoom(v) {
    v = Number(v);
    if (!v || isNaN(v)) return DEFAULT_ZOOM_PCT;
    return Math.min(130, Math.max(100, Math.round(v)));
  }

  /** 把放大比例写到全局 CSS 变量（预览中的卡片实时生效） */
  function applyZoom() {
    document.documentElement.style.setProperty('--bdvf-zoom', String(zoomPct / 100));
  }

  const PREVIEW_DELAY = 350;       // 悬停多久后开始加载预览（ms）
  const playUrlCache = new Map();  // bvid -> Promise<url|null>

  let previewCard = null;          // 正在预览的卡片
  let previewVideo = null;         // 正在播放的 video 元素
  let pendingCard = null;          // 等待延迟触发的卡片
  let hoverTimer = 0;

  function cardBvid(card) {
    const m = (card.getAttribute('href') || '').match(/\/video\/(BV[0-9A-Za-z]{10})/);
    return m ? m[1] : null;
  }

  /** 取播放直链（view -> playurl，带缓存；失败不缓存，可重试） */
  function getPlayUrl(bvid) {
    let p = playUrlCache.get(bvid);
    if (p) return p;
    p = (async () => {
      try {
        const view = await httpGet('https://api.bilibili.com/x/web-interface/view?bvid=' + bvid);
        if (!view || view.code !== 0 || !view.data || !view.data.pages || !view.data.pages.length) return null;
        const cid = view.data.pages[0].cid;
        const play = await httpGet(
          'https://api.bilibili.com/x/player/playurl' +
          `?bvid=${bvid}&cid=${cid}&qn=64&fnval=1&fnver=0&fourk=1&platform=pc`
        );
        if (!play || play.code !== 0 || !play.data || !play.data.durl || !play.data.durl.length) return null;
        return play.data.durl[0].url || null;
      } catch (e) {
        return null;
      }
    })();
    playUrlCache.set(bvid, p);
    p.then((url) => { if (!url) playUrlCache.delete(bvid); });
    if (playUrlCache.size > 60) playUrlCache.delete(playUrlCache.keys().next().value);
    return p;
  }

  function stopPreview() {
    const card = previewCard;
    const video = previewVideo;
    previewCard = null;
    previewVideo = null;
    if (card && card.classList.contains('bdvf-previewing')) card.classList.remove('bdvf-previewing');
    if (video) {
      try { video.pause(); } catch (e) { /* ignore */ }
      video.remove();
    }
  }

  function startPreview(card) {
    if (!previewEnabled || previewCard === card) return;
    const bvid = cardBvid(card);
    const cover = $('.bili-dyn-card-video__cover', card);
    if (!bvid || !cover) return;

    stopPreview();
    pendingCard = null;
    previewCard = card;
    card.classList.add('bdvf-previewing');

    getPlayUrl(bvid).then((url) => {
      if (previewCard !== card) return; // 已切换 / 已取消
      if (!url) { stopPreview(); return; }

      const video = document.createElement('video');
      video.className = 'bdvf-preview-video';
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.autoplay = true;
      video.src = url;
      video.addEventListener('playing', () => video.classList.add('bdvf-preview-video--show'));
      video.addEventListener('error', () => {
        playUrlCache.delete(bvid); // 直链可能过期，下次重取
        if (previewVideo === video) stopPreview();
      });
      cover.appendChild(video);
      previewVideo = video;

      const played = video.play();
      if (played && played.catch) played.catch(() => { if (previewVideo === video) stopPreview(); });

      // 兜底：长时间加载不出来就放弃
      setTimeout(() => {
        if (previewVideo === video && video.readyState < 2) stopPreview();
      }, 8000);
    });
  }

  // 事件委托（列表会不断重建，委托到 document 上最稳）
  document.addEventListener('mouseover', (ev) => {
    const card = ev.target && ev.target.closest ? ev.target.closest('a.bili-dyn-card-video') : null;
    if (!card || !previewEnabled) return;
    if (card === previewCard || card === pendingCard) return; // 已预览 / 已挂起
    clearTimeout(hoverTimer);
    pendingCard = card;
    hoverTimer = setTimeout(() => {
      if (pendingCard === card) startPreview(card);
    }, PREVIEW_DELAY);
  });

  document.addEventListener('mouseout', (ev) => {
    const card = ev.target && ev.target.closest ? ev.target.closest('a.bili-dyn-card-video') : null;
    if (!card) return;
    const to = ev.relatedTarget;
    if (to && card.contains(to)) return; // 卡片内部移动，不算离开
    if (pendingCard === card) {
      clearTimeout(hoverTimer);
      pendingCard = null;
    }
    if (previewCard === card) stopPreview();
  });

  /* ======================= 视频下载 ======================= */

  const MEDIABUNNY_URL = 'https://cdn.jsdelivr.net/npm/mediabunny@1.61.6/dist/bundles/mediabunny.min.mjs';
  const QN_NAMES = { 112: '1080P+', 80: '1080P', 64: '720P', 32: '480P', 16: '360P' };
  const DL_SVG = '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M9 2.5 V10.8 M5.6 7.6 L9 11 L12.4 7.6 M3.2 14.5 H14.8"/></svg>';

  let dlQn = Number(storeGet(KEY_DL_QN, DEFAULT_DL_QN));
  if (dlQn !== 0 && !QN_NAMES[dlQn]) dlQn = DEFAULT_DL_QN;
  let dlActive = false;
  let mbPromise = null;

  /** 动态加载 Mediabunny（多层兜底：直接 import → fetch+Blob → 页面 module 注入） */
  function loadMediabunny() {
    if (!mbPromise) {
      mbPromise = (async () => {
        try { return await import(MEDIABUNNY_URL); } catch (e) { /* 下一层 */ }
        try {
          const code = await (await fetch(MEDIABUNNY_URL)).text();
          const bUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
          const mod = await import(bUrl);
          URL.revokeObjectURL(bUrl);
          return mod;
        } catch (e) { /* 下一层 */ }
        return await new Promise((resolve, reject) => {
          const evt = 'bdvf_mb_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
          const s = document.createElement('script');
          s.type = 'module';
          s.textContent = 'import * as mb from ' + JSON.stringify(MEDIABUNNY_URL) + ';' +
            'window[' + JSON.stringify(evt) + '] = mb;' +
            'window.dispatchEvent(new Event(' + JSON.stringify(evt) + '));';
          const handler = () => {
            const w = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            const mod = w[evt];
            try { delete w[evt]; } catch (e) { /* ignore */ }
            s.remove();
            mod ? resolve(mod) : reject(new Error('组件加载失败'));
          };
          window.addEventListener(evt, handler, { once: true });
          (document.head || document.documentElement).appendChild(s);
          setTimeout(() => {
            window.removeEventListener(evt, handler);
            reject(new Error('组件加载超时，请检查网络'));
          }, 30000);
        });
      })().catch((e) => { mbPromise = null; throw e; });
    }
    return mbPromise;
  }

  /** 带进度的流式下载；依次尝试多个 URL（主线路 + 备用线路） */
  async function fetchU8(urls, onProgress) {
    let lastErr = null;
    for (const url of urls) {
      if (!url) continue;
      try {
        const resp = await fetch(url, { credentials: 'omit' });
        if (!resp.ok) { lastErr = new Error('HTTP ' + resp.status); continue; }
        const total = Number(resp.headers.get('content-length')) || 0;
        if (!resp.body || !resp.body.getReader) return new Uint8Array(await resp.arrayBuffer());
        const reader = resp.body.getReader();
        const chunks = [];
        let received = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.byteLength;
          if (onProgress && total) onProgress(Math.min(1, received / total));
        }
        const out = new Uint8Array(received);
        let off = 0;
        for (const c of chunks) { out.set(c, off); off += c.byteLength; }
        return out;
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('媒体流下载失败');
  }

  const streamUrls = (s) => [s.baseUrl || s.base_url].concat(s.backupUrl || s.backup_url || []).filter(Boolean);

  /** 选视频流：优先 H.264，画质不超过期望档（不可用则用最接近的画质） */
  function pickVideoStream(dash, wantQn) {
    const all = (dash.video || []).filter((v) => v && (v.baseUrl || v.base_url));
    if (!all.length) return null;
    const avc = all.filter((v) => String(v.codecs || '').startsWith('avc1'));
    const pool = (avc.length ? avc : all).slice().sort((a, b) => b.id - a.id);
    return pool.find((v) => v.id <= wantQn) || pool[pool.length - 1];
  }

  function pickAudioStream(dash) {
    const all = (dash.audio || []).filter((a) => a && (a.baseUrl || a.base_url));
    if (!all.length) return null;
    return all.slice().sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))[0];
  }

  /** 用 Mediabunny 把 fMP4 视频/音频流合并为 MP4（保留原始编码、支持 B 帧，无需 ffmpeg） */
  async function mergeToMp4(videoU8, audioU8) {
    const mb = await loadMediabunny();
    const output = new mb.Output({
      format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }),
      target: new mb.BufferTarget()
    });
    let vSrc = null, vSink = null, vCfg = null;
    let aSrc = null, aSink = null, aCfg = null;

    if (videoU8) {
      const input = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BufferSource(videoU8) });
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new Error('视频流解析失败');
      vCfg = await track.getDecoderConfig();
      vSink = new mb.EncodedPacketSink(track);
      vSrc = new mb.EncodedVideoPacketSource(await track.getCodec());
      output.addVideoTrack(vSrc);
    }
    if (audioU8) {
      const input = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BufferSource(audioU8) });
      const track = await input.getPrimaryAudioTrack();
      if (!track) throw new Error('音频流解析失败');
      aCfg = await track.getDecoderConfig();
      aSink = new mb.EncodedPacketSink(track);
      aSrc = new mb.EncodedAudioPacketSource(await track.getCodec());
      output.addAudioTrack(aSrc);
    }

    await output.start();
    if (vSrc) {
      let first = true;
      for await (const p of vSink.packets()) {
        await vSrc.add(p, first ? { decoderConfig: vCfg } : undefined);
        first = false;
      }
      vSrc.close();
    }
    if (aSrc) {
      let first = true;
      for await (const p of aSink.packets()) {
        await aSrc.add(p, first ? { decoderConfig: aCfg } : undefined);
        first = false;
      }
      aSrc.close();
    }
    await output.finalize();
    return output.target.buffer;
  }

  function saveData(data, filename) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: 'video/mp4' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  const safeName = (t) => String(t || 'video').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'video';

  async function downloadVideo(bvid, btn) {
    if (dlActive) { toast('已有下载任务进行中，请稍候', false); return; }
    dlActive = true;
    if (btn) btn.classList.add('bdvf-busy');
    const setText = (t) => { const el = btn && $('.bdvf-dl-btn__text', btn); if (el) el.textContent = t; };
    const markDone = () => {
      if (!btn) return;
      btn.classList.add('bdvf-done');
      setText('已保存');
      setTimeout(() => { if (btn.isConnected) { btn.classList.remove('bdvf-done'); setText('下载'); } }, 2500);
    };

    try {
      const audioOnly = dlQn === 0;
      setText('准备中…');

      const view = await httpGet('https://api.bilibili.com/x/web-interface/view?bvid=' + bvid);
      if (!view || view.code !== 0 || !view.data) throw new Error('无法获取视频信息（' + ((view && view.message) || '?') + '）');
      const cid = view.data.pages && view.data.pages[0] && view.data.pages[0].cid;
      if (!cid) throw new Error('无法获取视频 CID');
      const title = view.data.title || bvid;

      const reqQn = audioOnly ? 80 : dlQn;
      const pu = await httpGet(
        'https://api.bilibili.com/x/player/playurl' +
        `?bvid=${bvid}&cid=${cid}&qn=${reqQn}&fnval=16&fnver=0&fourk=1&platform=pc`
      );
      if (!pu || pu.code !== 0 || !pu.data) throw new Error('无法获取播放地址（' + ((pu && pu.message) || '?') + '）');

      const dash = pu.data.dash;
      if (!dash) {
        // 无 DASH：退回单文件 durl 下载（无法合并，画质上限较低）
        if (audioOnly) throw new Error('该视频不支持纯音频下载');
        const pu2 = await httpGet(
          'https://api.bilibili.com/x/player/playurl' +
          `?bvid=${bvid}&cid=${cid}&qn=64&fnval=1&fnver=0&fourk=1&platform=pc`
        );
        const durl = pu2 && pu2.data && pu2.data.durl && pu2.data.durl[0];
        if (!durl) throw new Error('无法获取下载地址');
        const u8 = await fetchU8([durl.url].concat(durl.backup_url || []), (p) => setText('下载 ' + Math.round(p * 100) + '%'));
        saveData(u8, safeName(title) + (QN_NAMES[pu2.data.quality] ? '_' + QN_NAMES[pu2.data.quality] : '') + '.mp4');
        toast('已保存：' + safeName(title) + '.mp4');
        markDone();
        return;
      }

      const aStream = pickAudioStream(dash);
      if (!aStream) throw new Error('未找到音频流');
      const vStream = audioOnly ? null : pickVideoStream(dash, dlQn);
      if (!audioOnly && !vStream) throw new Error('未找到可用视频流');

      let videoU8 = null;
      if (vStream) {
        if (vStream.id !== dlQn) {
          toast(`该视频无 ${QN_NAMES[dlQn] || dlQn + 'P'}，已改用 ${QN_NAMES[vStream.id] || vStream.id + 'P'}`);
        }
        videoU8 = await fetchU8(streamUrls(vStream), (p) => setText('视频 ' + Math.round(p * 70) + '%'));
      }
      const audioU8 = await fetchU8(streamUrls(aStream), (p) => setText('音频 ' + Math.round(70 + p * 20) + '%'));

      setText('合并中…');
      const merged = await mergeToMp4(videoU8, audioU8);

      const label = audioOnly ? 'audio' : (QN_NAMES[vStream.id] || vStream.id + 'P');
      const filename = safeName(title) + '_' + label + (audioOnly ? '.m4a' : '.mp4');
      saveData(new Blob([merged], { type: audioOnly ? 'audio/mp4' : 'video/mp4' }), filename);
      toast('已保存：' + filename);
      markDone();
    } catch (e) {
      toast('下载失败：' + ((e && e.message) || e), false);
      setText('下载');
    } finally {
      dlActive = false;
      if (btn) btn.classList.remove('bdvf-busy');
    }
  }

  function injectDlButton(item, bvid) {
    const footer = $('.bili-dyn-item__footer', item);
    if (!footer) return;

    let btn = $('.bdvf-dl-btn', footer);
    if (!btn) {
      const wrap = document.createElement('div');
      wrap.className = 'bili-dyn-item__action bdvf-fav-wrap';

      btn = document.createElement('div');
      btn.className = 'bili-dyn-action bdvf-dl-btn';
      btn.title = '下载视频（画质可在右下角面板「下载画质」设置）';
      btn.innerHTML = DL_SVG + '<span class="bdvf-dl-btn__text">下载</span>';
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        downloadVideo(bvid, btn);
      });

      wrap.appendChild(btn);
      footer.appendChild(wrap);
    }
    if (btn.dataset.bvid !== bvid) btn.dataset.bvid = bvid;
  }

  /* ======================= 右下角设置面板 ======================= */

  let panelEl = null;
  let statEl = null;
  let rangeEl = null;
  let numEl = null;
  let enableEl = null;
  let previewEnableEl = null;
  let zoomRangeEl = null;
  let zoomValEl = null;

  function buildPanel() {
    if (panelEl && panelEl.isConnected) return;

    panelEl = document.createElement('div');
    panelEl.className = 'bdvf-panel';
    panelEl.innerHTML = `
      <div class="bdvf-panel__head">
        <span>动态视频过滤</span>
        <span class="bdvf-panel__fold" title="折叠 / 展开">−</span>
      </div>
      <div class="bdvf-panel__body">
        <label class="bdvf-row bdvf-row--check">
          <input type="checkbox" class="bdvf-enable"> 启用过滤
        </label>
        <label class="bdvf-row bdvf-row--check">
          <input type="checkbox" class="bdvf-preview-enable"> 悬停放大播放
        </label>
        <div class="bdvf-row">
          <input type="range" class="bdvf-range" min="0" max="600" step="5">
        </div>
        <div class="bdvf-row bdvf-row--num">
          <span>小于</span>
          <input type="number" class="bdvf-num" min="0" max="99999" step="1">
          <span>秒的视频隐藏</span>
        </div>
        <div class="bdvf-row bdvf-row--num">
          <span>放大</span>
          <input type="range" class="bdvf-range bdvf-zoom-range" min="100" max="130" step="1">
          <span class="bdvf-zoom-val">106%</span>
        </div>
        <div class="bdvf-row bdvf-row--num">
          <span>下载画质</span>
          <select class="bdvf-select bdvf-dlqn">
            <option value="112">1080P+</option>
            <option value="80">1080P</option>
            <option value="64">720P</option>
            <option value="32">480P</option>
            <option value="16">360P</option>
            <option value="0">仅音频 m4a</option>
          </select>
        </div>
        <div class="bdvf-stat"></div>
      </div>`;
    document.body.appendChild(panelEl);

    rangeEl = $('.bdvf-range', panelEl);
    numEl = $('.bdvf-num', panelEl);
    enableEl = $('.bdvf-enable', panelEl);
    statEl = $('.bdvf-stat', panelEl);

    rangeEl.value = Math.min(600, minSec);
    numEl.value = minSec;
    enableEl.checked = enabled;

    rangeEl.addEventListener('input', () => {
      minSec = Math.max(0, Number(rangeEl.value) || 0);
      numEl.value = minSec;
      storeSet(KEY_MIN_SEC, minSec);
      scheduleScan();
    });

    numEl.addEventListener('input', () => {
      let v = parseInt(numEl.value, 10);
      if (isNaN(v) || v < 0) v = 0;
      minSec = v;
      rangeEl.value = Math.min(600, v);
      storeSet(KEY_MIN_SEC, minSec);
      scheduleScan();
    });

    enableEl.addEventListener('change', () => {
      enabled = enableEl.checked;
      storeSet(KEY_ENABLED, enabled);
      scheduleScan();
    });

    previewEnableEl = $('.bdvf-preview-enable', panelEl);
    previewEnableEl.checked = previewEnabled;
    previewEnableEl.addEventListener('change', () => {
      previewEnabled = previewEnableEl.checked;
      storeSet(KEY_PREVIEW, previewEnabled);
      if (!previewEnabled) stopPreview();
    });

    zoomRangeEl = $('.bdvf-zoom-range', panelEl);
    zoomValEl = $('.bdvf-zoom-val', panelEl);
    zoomRangeEl.value = zoomPct;
    zoomValEl.textContent = zoomPct + '%';
    zoomRangeEl.addEventListener('input', () => {
      zoomPct = clampZoom(zoomRangeEl.value);
      zoomValEl.textContent = zoomPct + '%';
      storeSet(KEY_ZOOM, zoomPct);
      applyZoom();
    });

    const dlQnEl = $('.bdvf-dlqn', panelEl);
    dlQnEl.value = String(dlQn);
    dlQnEl.addEventListener('change', () => {
      dlQn = Number(dlQnEl.value) || 0;
      storeSet(KEY_DL_QN, dlQn);
    });

    $('.bdvf-panel__head', panelEl).addEventListener('click', () => {
      panelEl.classList.toggle('bdvf-panel--collapsed');
      const fold = $('.bdvf-panel__fold', panelEl);
      fold.textContent = panelEl.classList.contains('bdvf-panel--collapsed') ? '+' : '−';
    });

    renderStats();
  }

  function renderStats() {
    if (!statEl) return;
    const text = `已隐藏 ${stats.hidden} / ${stats.total} 条视频动态`;
    if (statEl.textContent !== text) statEl.textContent = text;
  }

  /* ======================= 启动 ======================= */

  injectCSS(CSS);
  applyZoom();
  buildPanel();
  scheduleScan();

  // 列表懒加载 / tab 切换 / 翻页 都会重建 DOM，用 MutationObserver 兜住
  const mo = new MutationObserver(scheduleScan);
  mo.observe(document.documentElement, { childList: true, subtree: true });

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('显示 / 隐藏设置面板', () => {
      if (!panelEl || !panelEl.isConnected) { buildPanel(); return; }
      panelEl.style.display = panelEl.style.display === 'none' ? '' : 'none';
    });
  }
})();
