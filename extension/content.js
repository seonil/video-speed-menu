(() => {
  "use strict";
  if (document.querySelector("#video-speed-menu-root")) return;

  const SPEEDS = [1, 1.25, 1.5, 2, 3, 4, 5, 6, 7, 8];
  const host = document.createElement("div");
  host.id = "video-speed-menu-root";
  host.style.cssText = "position:fixed;z-index:2147483647;display:none;pointer-events:auto";
  const root = host.attachShadow({ mode: "open" });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
    :host { font: 13px/1.5 system-ui, sans-serif; color: #fff; }
    * { box-sizing: border-box; }
    .panel { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
    button { font: inherit; color: #fff; background: #243348; border: 1px solid #70839c;
      border-radius: 6px; padding: 6px 10px; cursor: pointer; }
    button:hover { background: #345376; }
    button:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
    #toggle { min-width: 56px; font-weight: 700; background: #172334ee; }
    #menu { width: 232px; padding: 10px; background: #152236f5; border: 1px solid #627993;
      border-radius: 10px; box-shadow: 0 6px 24px #0005; }
    #menu[hidden] { display: none; }
    .title { font-size: 12px; color: #c0d1e4; margin: 0 0 8px; }
    #choices { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; }
    #choices button { padding: 5px 2px; }
    #choices button[aria-pressed="true"] { background: #186fc6; border-color: #8fc8ff; }
    .keep { display: flex; gap: 6px; align-items: center; margin-top: 9px; font-size: 12px; }
    #status { background: #152236ee; border-radius: 5px; padding: 3px 7px; font-size: 11px; }
    #status[data-warning="true"] { background: #7f351c; }
  `);
  root.adoptedStyleSheets = [sheet];
  root.innerHTML = `<div class="panel">
    <button id="toggle" type="button" aria-label="비디오 배속 메뉴" aria-expanded="false">1×</button>
    <div id="menu" hidden>
      <p class="title">비디오 재생 속도</p>
      <div id="choices" role="group" aria-label="재생 배속"></div>
      <label class="keep"><input id="keep" type="checkbox" checked>선택한 배속 유지</label>
    </div>
    <span id="status" role="status">영상 대기 중</span>
  </div>`;
  document.documentElement.append(host);

  const toggle = root.getElementById("toggle");
  const menu = root.getElementById("menu");
  const status = root.getElementById("status");
  const keep = root.getElementById("keep");
  const choices = root.getElementById("choices");
  let activeVideo = null;
  let desiredRate = 1;
  let samples = [];
  let selectionLocked = false;
  const label = (rate) => `${Math.round(rate * 100) / 100}×`;

  function updateButtons() {
    toggle.textContent = label(desiredRate);
    for (const button of choices.children) {
      button.setAttribute("aria-pressed", String(Number(button.dataset.rate) === desiredRate));
    }
  }

  for (const rate of SPEEDS) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.rate = String(rate);
    button.textContent = label(rate);
    button.addEventListener("click", () => {
      desiredRate = rate;
      samples = [];
      updateButtons();
      applyRate();
      updateStatus();
    });
    choices.append(button);
  }
  updateButtons();

  toggle.addEventListener("click", () => {
    menu.hidden = !menu.hidden;
    selectionLocked = !menu.hidden;
    toggle.setAttribute("aria-expanded", String(!menu.hidden));
    position();
  });
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      menu.hidden = true;
      selectionLocked = false;
      toggle.setAttribute("aria-expanded", "false");
      toggle.focus();
    }
  });
  // Keep overlay input from triggering a surrounding video player's shortcuts.
  for (const type of ["click", "pointerdown", "keydown", "keyup"]) {
    host.addEventListener(type, (event) => event.stopPropagation());
  }

  function findVideo() {
    if (selectionLocked && activeVideo?.isConnected) return activeVideo;
    const candidates = [];
    for (const video of document.querySelectorAll("video")) {
      const rect = video.getBoundingClientRect();
      if (rect.width < 160 || rect.height < 90 || rect.bottom <= 0 || rect.top >= innerHeight ||
          rect.right <= 0 || rect.left >= innerWidth) continue;
      const style = getComputedStyle(video);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) continue;
      const area = Math.min(rect.width, innerWidth) * Math.min(rect.height, innerHeight);
      candidates.push({ video, score: area * (video.paused ? 1 : 2) });
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0]?.video ?? null;
  }

  function applyRate() {
    if (!activeVideo || !activeVideo.isConnected) return;
    if (Math.abs(activeVideo.playbackRate - desiredRate) < 0.01) return;
    try { activeVideo.playbackRate = desiredRate; }
    catch { status.textContent = "이 영상에서는 배속 적용이 지원되지 않습니다."; }
  }

  function position() {
    if (!activeVideo?.isConnected) { host.style.display = "none"; return; }
    const rect = activeVideo.getBoundingClientRect();
    const fullscreen = document.fullscreenElement;
    // Browsers render a native fullscreen video in a separate surface.
    if (fullscreen === activeVideo || rect.bottom <= 0 || rect.top >= innerHeight) {
      host.style.display = "none";
      return;
    }
    const parent = fullscreen?.contains(activeVideo) ? fullscreen : document.documentElement;
    if (host.parentElement !== parent) parent.append(host);
    host.style.display = "block";
    host.style.top = `${Math.max(8, Math.min(rect.top + 12, innerHeight - host.offsetHeight - 8))}px`;
    host.style.left = `${Math.max(8, Math.min(rect.right - host.offsetWidth - 12, innerWidth - host.offsetWidth - 8))}px`;
  }

  function sampleProgress() {
    if (!activeVideo || activeVideo.paused || activeVideo.seeking) { samples = []; return; }
    const next = { wall: performance.now(), media: activeVideo.currentTime };
    const previous = samples.at(-1);
    if (previous) {
      const elapsed = (next.wall - previous.wall) / 1000;
      const delta = next.media - previous.media;
      if (delta < -0.5 || delta > elapsed * 12 + 2) samples = [];
    }
    samples.push(next);
    while (samples.length > 2 && next.wall - samples[0].wall > 5000) samples.shift();
  }

  function updateStatus() {
    if (!activeVideo) return;
    let message = "측정 중";
    let warning = false;
    if (activeVideo.paused) message = "일시정지";
    else if (samples.length > 1) {
      const first = samples[0], last = samples.at(-1);
      const elapsed = (last.wall - first.wall) / 1000;
      if (elapsed >= 2) {
        const measured = (last.media - first.media) / elapsed;
        message = `실측 ${label(Math.round(measured * 10) / 10)}`;
        warning = measured < desiredRate * 0.8;
      }
    }
    status.textContent = `설정 ${label(desiredRate)} / ${message}`;
    status.dataset.warning = String(warning);
  }

  function tick() {
    const next = findVideo();
    if (next !== activeVideo) {
      activeVideo = next;
      samples = [];
      desiredRate = activeVideo?.playbackRate ?? 1;
      updateButtons();
    }
    if (activeVideo) {
      if (keep.checked) applyRate();
      else if (Math.abs(activeVideo.playbackRate - desiredRate) >= 0.01) {
        desiredRate = activeVideo.playbackRate;
        updateButtons();
      }
      sampleProgress();
      updateStatus();
    }
    position();
  }
  setInterval(tick, 300);
  document.addEventListener("scroll", position, { passive: true, capture: true });
  window.addEventListener("resize", position, { passive: true });
  document.addEventListener("fullscreenchange", position);
  tick();
})();
