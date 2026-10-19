(function () {
  let socket = null;
  let currentTasks = [];
  let currentEvents = [];
  let focusedTaskId = null;
  let inspectorSelectedTaskId = null;
  let doubleClickedSubtreeId = null;

  // View Modes: 'OBSIDIAN_GRAPH_VIEW' | 'GANTT_VIEW'
  let currentViewMode = 'OBSIDIAN_GRAPH_VIEW';

  // Edge Nest Depth Filter (1, 2, 3... or 'all')
  let currentMaxDepth = 'all';

  // Display Days Range for Timeline Mode (7, 14, 30, 60)
  let currentDaysRange = 14;

  // Timeline Canvas Horizontal Pan Offset
  let canvasPanOffsetX = 0;
  let isPanningCanvas = false;
  let panStartX = 0;
  let hasPanned = false;

  // Graph Text Size Filter ('small' | 'medium' | 'large')
  let currentFontSizeMode = 'medium';

  // Zone Label Visibility (Past & Future)
  let showPastLabels = true;
  let showFutureLabels = true;
  let hoveredEyeZone = null; // 'past' | 'future' | null

  try {
    const savedPast = localStorage.getItem('wbser_show_past_labels');
    if (savedPast !== null) showPastLabels = savedPast === 'true';
    const savedFuture = localStorage.getItem('wbser_show_future_labels');
    if (savedFuture !== null) showFutureLabels = savedFuture === 'true';
  } catch (e) {}

  function togglePastLabels() {
    showPastLabels = !showPastLabels;
    try {
      localStorage.setItem('wbser_show_past_labels', String(showPastLabels));
    } catch (e) {}
    renderCurrentView();
  }

  function toggleFutureLabels() {
    showFutureLabels = !showFutureLabels;
    try {
      localStorage.setItem('wbser_show_future_labels', String(showFutureLabels));
    } catch (e) {}
    renderCurrentView();
  }

  // 1. Theme Manager (Dark / Light Theme Switcher)
  const btnThemeToggle = document.getElementById('btn-theme-toggle');
  const themeToggleIcon = document.getElementById('theme-toggle-icon');

  function initTheme() {
    const savedTheme = localStorage.getItem('share_log_theme') || 'dark';
    applyTheme(savedTheme);
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    if (themeToggleIcon) {
      themeToggleIcon.textContent = theme === 'dark' ? 'ダーク' : 'ライト';
    }
    localStorage.setItem('share_log_theme', theme);
  }

  if (btnThemeToggle) {
    btnThemeToggle.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      const next = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      if (currentViewMode === 'OBSIDIAN_GRAPH_VIEW') {
        renderCurrentView();
      }
    });
  }

  function getTaskDepth(task) {
    let depth = 0;
    let curr = task;
    const visited = new Set();
    while (curr && curr.parentId && !visited.has(curr.id)) {
      visited.add(curr.id);
      depth++;
      curr = currentTasks.find((t) => t.id === curr.parentId);
    }
    return depth;
  }

  function getDescendantIds(startTaskId) {
    if (!startTaskId) return null;
    const descendantIds = new Set([startTaskId]);
    const queue = [startTaskId];
    while (queue.length > 0) {
      const parentId = queue.shift();
      currentTasks.forEach((t) => {
        if (t.parentId === parentId && !descendantIds.has(t.id)) {
          descendantIds.add(t.id);
          queue.push(t.id);
        }
      });
    }
    return descendantIds;
  }

  function getRelativeDepth(task, selectedTaskId) {
    if (!task || !selectedTaskId) return null;
    let relDepth = 0;
    let currId = task.id;
    const visited = new Set();
    while (currId) {
      if (currId === selectedTaskId) return relDepth;
      if (visited.has(currId)) break;
      visited.add(currId);
      const currTask = currentTasks.find((t) => t.id === currId);
      if (!currTask || !currTask.parentId) break;
      currId = currTask.parentId;
      relDepth++;
    }
    return null;
  }
 
  function isIsolatedTask(task) {
    if (!task || task.parentId) return false;
    return !currentTasks.some((t) => t.parentId === task.id);
  }


  // Dynamic Y Ratio calculation automatically adjusting to the max visible nest depth & inspector panel
  function computeDynamicYRatio(depth, maxTreeDepth, isSelectedTree = false, isInspectorOpen = false) {
    const topY = 0.18;
    const bottomY = isInspectorOpen ? 0.65 : (isSelectedTree ? 0.80 : 0.77);

    if (maxTreeDepth <= 0) {
      return isInspectorOpen ? 0.35 : 0.45; // Center single-level tasks vertically, slightly higher if inspector open
    }

    const ratio = Math.min(1, Math.max(0, depth / maxTreeDepth));
    return topY + ratio * (bottomY - topY);
  }

  // Sugiyama Layered Tree Layout Helper (Calculates non-overlapping X columns for subtrees)
  function computeSugiyamaTreeXPositions(visibleTasks, width, focusedRootId = null) {
    const parentToChildren = new Map();
    visibleTasks.forEach((t) => {
      const pId = t.parentId || '__ROOT__';
      if (!parentToChildren.has(pId)) parentToChildren.set(pId, []);
      parentToChildren.get(pId).push(t);
    });

    const xPosMap = new Map();

    // 1. If focusedRootId is specified and present in visible tasks, compute wide spread layout for its subtree
    if (focusedRootId && visibleTasks.some((t) => t.id === focusedRootId)) {
      const activeDescendants = getDescendantIds(focusedRootId);

      function countSubtreeLeaves(taskId) {
        const children = (parentToChildren.get(taskId) || []).filter((c) => activeDescendants.has(c.id));
        if (children.length === 0) return 1;
        let sum = 0;
        children.forEach((c) => {
          sum += countSubtreeLeaves(c.id);
        });
        return Math.max(1, sum);
      }

      const totalSubtreeLeaves = countSubtreeLeaves(focusedRootId);
      const padX = Math.min(80, width * 0.08);
      const usableWidth = Math.max(300, width - 2 * padX);
      let currentLeafIdx = 0;

      function assignSubtreeX(taskId) {
        const children = (parentToChildren.get(taskId) || []).filter((c) => activeDescendants.has(c.id));
        if (children.length === 0) {
          const ratio = (currentLeafIdx + 0.5) / totalSubtreeLeaves;
          const x = padX + ratio * usableWidth;
          xPosMap.set(taskId, x);
          currentLeafIdx += 1;
          return x;
        }

        const childXs = children.map((c) => assignSubtreeX(c.id));
        const minX = Math.min(...childXs);
        const maxX = Math.max(...childXs);
        // Root of the focused subtree stays horizontally centered at width / 2
        const parentX = taskId === focusedRootId ? width / 2 : (minX + maxX) / 2;
        xPosMap.set(taskId, parentX);
        return parentX;
      }

      assignSubtreeX(focusedRootId);

      // Compute standard positions for non-active background nodes
      const nonActiveTasks = visibleTasks.filter((t) => !activeDescendants.has(t.id));
      if (nonActiveTasks.length > 0) {
        const globalXMap = computeSugiyamaTreeXPositions(nonActiveTasks, width, null);
        nonActiveTasks.forEach((t) => {
          if (!xPosMap.has(t.id) && globalXMap.has(t.id)) {
            xPosMap.set(t.id, globalXMap.get(t.id));
          }
        });
      }
      return xPosMap;
    }

    const rootTasks = visibleTasks.filter(
      (t) => !t.parentId || !visibleTasks.some((p) => p.id === t.parentId)
    );

    const leafCountMap = new Map();
    function countLeaves(taskId) {
      const children = parentToChildren.get(taskId) || [];
      if (children.length === 0) {
        leafCountMap.set(taskId, 1);
        return 1;
      }
      let sum = 0;
      children.forEach((child) => {
        sum += countLeaves(child.id);
      });
      leafCountMap.set(taskId, Math.max(1, sum));
      return sum;
    }

    let totalLeaves = 0;
    rootTasks.forEach((root) => {
      totalLeaves += countLeaves(root.id);
    });
    totalLeaves = Math.max(1, totalLeaves);

    const padX = Math.min(65, width * 0.06);
    const usableWidth = Math.max(300, width - 2 * padX);
    let currentLeafIndex = 0;

    function assignX(taskId) {
      const children = parentToChildren.get(taskId) || [];
      if (children.length === 0) {
        const leafCenterRatio = (currentLeafIndex + 0.5) / totalLeaves;
        const x = padX + leafCenterRatio * usableWidth;
        xPosMap.set(taskId, x);
        currentLeafIndex += 1;
        return x;
      }

      const childXs = children.map((c) => assignX(c.id));
      const minChildX = Math.min(...childXs);
      const maxChildX = Math.max(...childXs);
      const parentX = (minChildX + maxChildX) / 2;
      xPosMap.set(taskId, parentX);
      return parentX;
    }

    rootTasks.forEach((root) => {
      assignX(root.id);
    });

    // Ensure reasonable horizontal spacing between tasks at the same depth, strictly bounded within [padX, width - padX]
    const tasksByDepth = new Map();
    visibleTasks.forEach((t) => {
      const d = getTaskDepth(t);
      if (!tasksByDepth.has(d)) tasksByDepth.set(d, []);
      tasksByDepth.get(d).push(t);
    });

    tasksByDepth.forEach((tasksAtDepth) => {
      if (tasksAtDepth.length <= 1) return;
      tasksAtDepth.sort((a, b) => (xPosMap.get(a.id) || 0) - (xPosMap.get(b.id) || 0));

      const maxAllowedSpacing = usableWidth / Math.max(1, tasksAtDepth.length - 1);

      for (let i = 1; i < tasksAtDepth.length; i++) {
        const prevTask = tasksAtDepth[i - 1];
        const curTask = tasksAtDepth[i];
        let prevX = xPosMap.get(prevTask.id) || 0;
        let curX = xPosMap.get(curTask.id) || 0;
        const charWidth = currentFontSizeMode === 'large' ? 14 : (currentFontSizeMode === 'small' ? 8 : 10);
        const curW = (curTask.title || '').length * charWidth + 24;

        // Adjacent tasks (different tier)
        const prevW = (prevTask.title || '').length * charWidth + 24;
        const desiredSpacing = Math.min(maxAllowedSpacing, Math.max(55, (prevW + curW) / 2 + 16));
        if (curX - prevX < desiredSpacing) {
          curX = prevX + desiredSpacing;
          xPosMap.set(curTask.id, curX);
        }

        // Same-tier tasks (i and i-2): ensure horizontal separation so labels at same Y never overlap
        if (i >= 2) {
          const prev2Task = tasksAtDepth[i - 2];
          const prev2X = xPosMap.get(prev2Task.id) || 0;
          const prev2W = (prev2Task.title || '').length * charWidth + 24;
          const desiredSameTierSpacing = Math.min(maxAllowedSpacing * 2, (prev2W + curW) / 2 + 20);
          if (curX - prev2X < desiredSameTierSpacing) {
            curX = prev2X + desiredSameTierSpacing;
            xPosMap.set(curTask.id, curX);
          }
        }
      }

      // Strictly rescale/normalize tasks at this depth to fit cleanly within [padX, width - padX]
      const firstX = xPosMap.get(tasksAtDepth[0].id) || padX;
      const lastX = xPosMap.get(tasksAtDepth[tasksAtDepth.length - 1].id) || (width - padX);
      if (lastX > width - padX || firstX < padX) {
        const currentSpan = Math.max(1, lastX - firstX);
        const targetSpan = width - 2 * padX;
        tasksAtDepth.forEach((t) => {
          const cur = xPosMap.get(t.id) || firstX;
          const ratio = (cur - firstX) / currentSpan;
          xPosMap.set(t.id, padX + ratio * targetSpan);
        });
      }
    });

    return xPosMap;
  }


  // Canvas Animation Frame & Physics State
  let canvasAnimationId = null;
  let graphNodes = [];
  let timelineSlotMap = new Map();
  let draggedGraphNode = null;
  let isMouseDown = false;

  // DOM Elements
  const nodeDisplay = document.getElementById('node-id-display');
  const errorToast = document.getElementById('error-toast');
  const btnUndo = document.getElementById('btn-undo');

  const quickForm = document.getElementById('quick-task-form');
  const quickInputTitle = document.getElementById('quick-title-input');
  const selectQuickParent = document.getElementById('select-quick-parent');

  const obsidianGraphViewSection = document.getElementById('obsidian-graph-view');
  const canvas = document.getElementById('obsidian-canvas');

  const obsidianInspector = document.getElementById('obsidian-inspector');
  const inspectorBreadcrumb = document.getElementById('inspector-breadcrumb');
  const inspectorStatusBadge = document.getElementById('inspector-status-badge');
  const inspectorTitleInput = document.getElementById('inspector-title-input');
  const inspectorDueDateInput = document.getElementById('inspector-due-date-input');
  const btnInspectorClose = document.getElementById('btn-inspector-close');
  const btnInspectorElevate = document.getElementById('btn-inspector-elevate');
  const btnInspectorDelete = document.getElementById('btn-inspector-delete');

  let hoveredNodeId = null;

  const confirmModal = document.getElementById('confirm-parent-modal');
  const confirmModalTitle = document.getElementById('confirm-modal-title');
  const confirmModalText = document.getElementById('confirm-modal-text');
  const btnModalCancel = document.getElementById('btn-modal-cancel');
  const btnModalConfirm = document.getElementById('btn-modal-confirm');

  const deleteReasonModal = document.getElementById('delete-reason-modal');
  const deleteReasonInput = document.getElementById('delete-reason-input');
  const deleteReasonCount = document.getElementById('delete-reason-count');
  const btnDeleteReasonCancel = document.getElementById('btn-delete-reason-cancel');
  const btnDeleteReasonConfirm = document.getElementById('btn-delete-reason-confirm');

  const inProgressDueModal = document.getElementById('in-progress-due-modal');
  const inProgressDateInput = document.getElementById('in-progress-date-input');
  const btnInProgressCancel = document.getElementById('btn-in-progress-cancel');
  const btnInProgressConfirm = document.getElementById('btn-in-progress-confirm');

  // WebSocket Setup
  function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      console.log('[WebSocket] Connected to Local Node');
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'STATE_INIT' || data.type === 'STATE_UPDATE') {
          nodeDisplay.textContent = `Node: ${data.nodeId}`;
          currentTasks = data.state.tasks || [];
          currentEvents = data.events || [];
          updateParentTaskOptions();
          updateInspectorViewIfNeeded();
          renderCurrentView();
        } else if (data.type === 'ERROR') {
          showErrorToast(data.message);
        }
      } catch (e) {
        console.error('[WS Data Error]', e);
      }
    };

    socket.onclose = () => {
      nodeDisplay.textContent = 'Node: Disconnected (Retrying...)';
      setTimeout(initWebSocket, 2000);
    };
  }

  let toastTimeoutId = null;
  function showNotificationToast(msg, type = 'info') {
    if (!errorToast) return;
    if (toastTimeoutId) clearTimeout(toastTimeoutId);
    errorToast.textContent = msg;
    errorToast.className = 'toast';
    if (type === 'success') errorToast.classList.add('toast-success');
    else if (type === 'info') errorToast.classList.add('toast-info');
    errorToast.classList.remove('hidden');
    toastTimeoutId = setTimeout(() => {
      errorToast.classList.add('hidden');
    }, 3500);
  }

  function showErrorToast(msg) {
    showNotificationToast(msg, 'error');
  }

  function updateParentTaskOptions() {
    const prevVal = selectQuickParent.value;
    selectQuickParent.innerHTML = '';

    const rootOpt = document.createElement('option');
    rootOpt.value = '';
    rootOpt.textContent = 'ルートタスク (親指定なし)';
    selectQuickParent.appendChild(rootOpt);

    currentTasks.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = `タスク: ${t.title}`;
      selectQuickParent.appendChild(opt);
    });

    if (prevVal && currentTasks.some((t) => t.id === prevVal)) {
      selectQuickParent.value = prevVal;
    }
  }

  // Helper to sync overlay control panel states (Relative Nest & Days Filter)
  function updateFilterControlsState() {
    const selectedId = doubleClickedSubtreeId || focusedTaskId;
    const activeTreeSet = selectedId ? getDescendantIds(selectedId) : null;
    const isTimelineMode = Boolean(selectedId && activeTreeSet);

    if (obsidianGraphViewSection) {
      obsidianGraphViewSection.classList.toggle('timeline-mode-active', isTimelineMode);
    }

    const depthFilterLabel = document.getElementById('depth-filter-label');
    const daysFilterGroup = document.getElementById('days-filter-group');
    const daysFilterDivider = document.getElementById('days-filter-divider');

    if (depthFilterLabel) {
      depthFilterLabel.textContent = selectedId ? '相対ネスト:' : 'ネスト:';
    }
    if (daysFilterGroup) {
      daysFilterGroup.classList.toggle('disabled-fade', !selectedId);
    }
    if (daysFilterDivider) {
      daysFilterDivider.classList.toggle('disabled-fade', !selectedId);
    }
  }


  // Graph Overlay Control Panel (Depth Filter + Display Days Filter + Font Size Filter)
  const depthFilterControl = document.getElementById('depth-filter-control');
  if (depthFilterControl) {
    depthFilterControl.addEventListener('click', (e) => {
      const depthBtn = e.target.closest('.depth-btn');
      if (depthBtn) {
        document.querySelectorAll('.depth-btn').forEach((b) => b.classList.remove('active'));
        depthBtn.classList.add('active');
        const val = depthBtn.dataset.depth;
        currentMaxDepth = val === 'all' ? 'all' : parseInt(val, 10);
        renderCurrentView();
        return;
      }

      const daysBtn = e.target.closest('.days-btn');
      if (daysBtn) {
        document.querySelectorAll('.days-btn').forEach((b) => b.classList.remove('active'));
        daysBtn.classList.add('active');
        currentDaysRange = parseInt(daysBtn.dataset.days, 10) || 14;
        canvasPanOffsetX = 0;
        renderCurrentView();
        return;
      }

      const fontBtn = e.target.closest('.fontsize-btn');
      if (fontBtn) {
        document.querySelectorAll('.fontsize-btn').forEach((b) => b.classList.remove('active'));
        fontBtn.classList.add('active');
        currentFontSizeMode = fontBtn.dataset.size || 'medium';
        renderCurrentView();
        return;
      }
    });
  }

  function getGraphFontSize(isSelectedRoot) {
    if (currentFontSizeMode === 'small') {
      return isSelectedRoot ? 10 : 9;
    }
    if (currentFontSizeMode === 'large') {
      return isSelectedRoot ? 18 : 15;
    }
    return isSelectedRoot ? 14 : 12;
  }

  function renderCurrentView() {
    if (canvasAnimationId) {
      cancelAnimationFrame(canvasAnimationId);
      canvasAnimationId = null;
    }
    startObsidianGraphRenderer();
  }

  // --------------------------------------------------------------------------
  // Date Axis Header Renderer for Obsidian Graph View Timeline Mode
  // --------------------------------------------------------------------------
  function getTimelineLayoutMetrics(width) {
    const zone1Start = 10;
    const zone1End = 106;
    const zone1Width = zone1End - zone1Start; // 96
    const zone1Center = (zone1Start + zone1End) / 2; // 58

    const zone2Start = 112;
    const zone2End = 202;
    const zone2Width = zone2End - zone2Start; // 90
    const zone2Center = (zone2Start + zone2End) / 2; // 157

    const zone4Width = 96;
    const zone4End = width - 10;
    const zone4Start = zone4End - zone4Width; // width - 106
    const zone4Center = (zone4Start + zone4End) / 2;

    const timelineStartX = 208;
    const timelineEndX = zone4Start - 6; // width - 112
    const timelineWidth = Math.max(120, timelineEndX - timelineStartX);
    const dayWidth = Math.max(26, timelineWidth / currentDaysRange);

    return {
      zone1Start, zone1End, zone1Width, zone1Center,
      zone2Start, zone2End, zone2Width, zone2Center,
      timelineStartX, timelineEndX, timelineWidth, dayWidth,
      zone4Start, zone4End, zone4Width, zone4Center
    };
  }

  function drawEyeIcon(ctx, cx, cy, isVisible, isHovered, isLight) {
    ctx.save();
    ctx.strokeStyle = isHovered
      ? (isLight ? '#0f172a' : '#f8fafc')
      : isVisible
      ? (isLight ? '#475569' : '#cbd5e1')
      : (isLight ? '#94a3b8' : '#71717a');
    ctx.lineWidth = 1.35;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Outer eye contour
    ctx.beginPath();
    ctx.moveTo(cx - 6.5, cy);
    ctx.quadraticCurveTo(cx, cy - 4.5, cx + 6.5, cy);
    ctx.quadraticCurveTo(cx, cy + 4.5, cx - 6.5, cy);
    ctx.stroke();

    if (isVisible) {
      // Pupil circle
      ctx.beginPath();
      ctx.arc(cx, cy, 2.0, 0, Math.PI * 2);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fill();
    } else {
      // Small center dot
      ctx.beginPath();
      ctx.arc(cx, cy, 1.4, 0, Math.PI * 2);
      ctx.fillStyle = isLight ? '#94a3b8' : '#71717a';
      ctx.fill();

      // Clean diagonal strike-through slash
      ctx.beginPath();
      ctx.moveTo(cx - 5.5, cy + 4.5);
      ctx.lineTo(cx + 5.5, cy - 4.5);
      ctx.strokeStyle = isLight ? '#dc2626' : '#f87171';
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawCanvasDateAxis(ctx, width, height, isLight) {
    const metrics = getTimelineLayoutMetrics(width);
    const originX = metrics.timelineStartX + canvasPanOffsetX;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    ctx.save();

    // 1. Zone 1: Unscheduled Column Header
    ctx.fillStyle = isLight ? 'rgba(241, 245, 249, 0.95)' : 'rgba(30, 41, 59, 0.85)';
    ctx.strokeStyle = isLight ? 'rgba(203, 213, 225, 0.85)' : 'rgba(51, 65, 85, 0.85)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(metrics.zone1Start, 14, metrics.zone1Width, 42, 6);
    } else {
      ctx.rect(metrics.zone1Start, 14, metrics.zone1Width, 42);
    }
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = isLight ? '#475569' : '#94a3b8';
    ctx.font = 'bold 11px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('📅 期日未設定', metrics.zone1Center, 35);

    // Vertical dividing line 1 (between Zone 1 & Zone 2)
    ctx.strokeStyle = isLight ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(metrics.zone1End + 3, 10);
    ctx.lineTo(metrics.zone1End + 3, height - 10);
    ctx.stroke();

    // 2. Zone 2: Past Header
    ctx.fillStyle = isLight ? 'rgba(241, 245, 249, 0.95)' : 'rgba(39, 39, 42, 0.85)';
    ctx.strokeStyle = isLight ? 'rgba(203, 213, 225, 0.85)' : 'rgba(63, 63, 70, 0.85)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(metrics.zone2Start, 14, metrics.zone2Width, 42, 6);
    } else {
      ctx.rect(metrics.zone2Start, 14, metrics.zone2Width, 42);
    }
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = isLight ? '#475569' : '#a1a1aa';
    ctx.font = 'bold 11px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('◀ 過去', metrics.zone2Start + 35, 35);

    // Zone 2 Eye Icon Button
    const z2BtnX = metrics.zone2End - 26;
    const z2BtnY = 24;
    const z2BtnW = 20;
    const z2BtnH = 22;
    const isPastEyeHovered = hoveredEyeZone === 'past';

    ctx.fillStyle = isPastEyeHovered
      ? (isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.16)')
      : (isLight ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255, 255, 255, 0.06)');
    ctx.strokeStyle = isPastEyeHovered
      ? (isLight ? 'rgba(0, 0, 0, 0.25)' : 'rgba(255, 255, 255, 0.35)')
      : (isLight ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.14)');
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(z2BtnX, z2BtnY, z2BtnW, z2BtnH, 4);
    } else {
      ctx.rect(z2BtnX, z2BtnY, z2BtnW, z2BtnH);
    }
    ctx.fill();
    ctx.stroke();

    drawEyeIcon(ctx, z2BtnX + z2BtnW / 2, z2BtnY + z2BtnH / 2, showPastLabels, isPastEyeHovered, isLight);


    // Vertical dividing line 2 (between Zone 2 & Timeline)
    ctx.beginPath();
    ctx.moveTo(metrics.zone2End + 3, 10);
    ctx.lineTo(metrics.zone2End + 3, height - 10);
    ctx.stroke();

    // 3. Zone 3: Timeline Axis Header Background
    ctx.fillStyle = isLight ? 'rgba(248, 250, 252, 0.92)' : 'rgba(15, 23, 42, 0.88)';
    ctx.fillRect(metrics.timelineStartX, 12, metrics.timelineWidth, 46);
    ctx.strokeStyle = isLight ? 'rgba(226, 232, 240, 0.9)' : 'rgba(30, 41, 59, 0.9)';
    ctx.lineWidth = 1;
    ctx.strokeRect(metrics.timelineStartX, 12, metrics.timelineWidth, 46);

    // Horizontal Ruler Axis Line
    ctx.strokeStyle = isLight ? 'rgba(148, 163, 184, 0.6)' : 'rgba(71, 85, 105, 0.6)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(metrics.timelineStartX, 52);
    ctx.lineTo(metrics.timelineEndX, 52);
    ctx.stroke();

    // Calculate visible day range
    const minDay = Math.floor((metrics.timelineStartX - originX) / metrics.dayWidth) - 1;
    const maxDay = Math.ceil((metrics.timelineEndX - originX) / metrics.dayWidth) + 1;

    for (let d = minDay; d <= maxDay; d++) {
      const x = originX + (d + 0.5) * metrics.dayWidth;
      if (x < metrics.timelineStartX || x > metrics.timelineEndX) continue;

      const dateObj = new Date(today.getTime() + d * 86400000);
      const isToday = d === 0;
      const dayOfWeek = dateObj.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const dayOfWeekStr = ['日', '月', '火', '水', '木', '金', '土'][dayOfWeek];
      const m = dateObj.getMonth() + 1;
      const dayNum = dateObj.getDate();

      // Vertical Grid Guide Line
      ctx.beginPath();
      ctx.moveTo(x, 58);
      ctx.lineTo(x, height - 15);
      ctx.strokeStyle = isToday
        ? 'rgba(16, 185, 129, 0.4)'
        : (isWeekend ? (isLight ? 'rgba(239, 68, 68, 0.12)' : 'rgba(239, 68, 68, 0.12)') : (isLight ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.05)'));
      ctx.lineWidth = isToday ? 2 : 1;
      ctx.setLineDash(isToday ? [] : [3, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Tick mark on ruler
      ctx.strokeStyle = isToday ? '#10b981' : (isLight ? 'rgba(100, 116, 139, 0.5)' : 'rgba(148, 163, 184, 0.5)');
      ctx.lineWidth = isToday ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x, 46);
      ctx.lineTo(x, 52);
      ctx.stroke();

      // Tick Labels
      const shouldShowLabel =
        currentDaysRange <= 14 ||
        (currentDaysRange === 30 && (d % 2 === 0 || isToday)) ||
        (currentDaysRange === 60 && (d % 5 === 0 || isToday));

      if (shouldShowLabel) {
        if (isToday) {
          ctx.fillStyle = '#10b981';
          const badgeW = Math.min(54, metrics.dayWidth * 0.95);
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(x - badgeW / 2, 17, badgeW, 24, 4);
          } else {
            ctx.rect(x - badgeW / 2, 17, badgeW, 24);
          }
          ctx.fill();

          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 10px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`今日 ${m}/${dayNum}`, x, 29);
        } else {
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = isWeekend ? '600 10px Inter, sans-serif' : '500 10px Inter, sans-serif';
          ctx.fillStyle = isWeekend ? (dayOfWeek === 0 ? '#ef4444' : '#3b82f6') : (isLight ? '#475569' : '#cbd5e1');
          ctx.fillText(`${m}/${dayNum} (${dayOfWeekStr})`, x, 25);

          ctx.font = '400 9px Inter, sans-serif';
          ctx.fillStyle = isLight ? '#94a3b8' : '#64748b';
          ctx.fillText(d > 0 ? `+${d}日` : `${d}日`, x, 39);
        }
      }
    }

    // Vertical dividing line 3 (between Timeline & Zone 4)
    ctx.strokeStyle = isLight ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(metrics.timelineEndX + 3, 10);
    ctx.lineTo(metrics.timelineEndX + 3, height - 10);
    ctx.stroke();

    // 4. Zone 4: Future Header
    ctx.fillStyle = isLight ? 'rgba(238, 242, 255, 0.95)' : 'rgba(30, 27, 75, 0.45)';
    ctx.strokeStyle = isLight ? 'rgba(199, 210, 254, 0.85)' : 'rgba(67, 56, 202, 0.85)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(metrics.zone4Start, 14, metrics.zone4Width, 42, 6);
    } else {
      ctx.rect(metrics.zone4Start, 14, metrics.zone4Width, 42);
    }
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = isLight ? '#4338ca' : '#a5b4fc';
    ctx.font = 'bold 11px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('未来 ▶', metrics.zone4Start + 36, 35);

    // Zone 4 Eye Icon Button
    const z4BtnX = metrics.zone4End - 26;
    const z4BtnY = 24;
    const z4BtnW = 20;
    const z4BtnH = 22;
    const isFutureEyeHovered = hoveredEyeZone === 'future';

    ctx.fillStyle = isFutureEyeHovered
      ? (isLight ? 'rgba(67, 56, 202, 0.16)' : 'rgba(165, 180, 252, 0.22)')
      : (isLight ? 'rgba(67, 56, 202, 0.08)' : 'rgba(165, 180, 252, 0.09)');
    ctx.strokeStyle = isFutureEyeHovered
      ? (isLight ? 'rgba(67, 56, 202, 0.4)' : 'rgba(165, 180, 252, 0.4)')
      : (isLight ? 'rgba(67, 56, 202, 0.2)' : 'rgba(165, 180, 252, 0.2)');
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(z4BtnX, z4BtnY, z4BtnW, z4BtnH, 4);
    } else {
      ctx.rect(z4BtnX, z4BtnY, z4BtnW, z4BtnH);
    }
    ctx.fill();
    ctx.stroke();

    drawEyeIcon(ctx, z4BtnX + z4BtnW / 2, z4BtnY + z4BtnH / 2, showFutureLabels, isFutureEyeHovered, isLight);
    ctx.setLineDash([]);

    // "今日へ戻る" Indicator Button if canvas is panned away
    if (Math.abs(canvasPanOffsetX) > 20) {
      ctx.fillStyle = isLight ? 'rgba(16, 185, 129, 0.15)' : 'rgba(16, 185, 129, 0.25)';
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(metrics.timelineStartX + 10, 60, 85, 22, 11);
      } else {
        ctx.rect(metrics.timelineStartX + 10, 60, 85, 22);
      }
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = isLight ? '#065f46' : '#6ee7b7';
      ctx.font = 'bold 10px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('↺ 今日へ戻る', metrics.timelineStartX + 52, 71);
    }

    ctx.restore();
  }


  // --------------------------------------------------------------------------
  // VIEW 1: Obsidian Canvas View & Node Click Quick Inspector
  // --------------------------------------------------------------------------
  let canvasResizeObserver = null;
  function setupCanvasResizeObserver() {
    if (canvasResizeObserver) return;
    const wrapper = canvas ? canvas.parentElement : null;
    if (!wrapper) return;
    if (window.ResizeObserver) {
      canvasResizeObserver = new ResizeObserver(() => {
        if (canvasAnimationId) {
          cancelAnimationFrame(canvasAnimationId);
          canvasAnimationId = null;
        }
        startObsidianGraphRenderer();
      });
      canvasResizeObserver.observe(wrapper);
    }
    window.addEventListener('resize', () => {
      if (canvasAnimationId) {
        cancelAnimationFrame(canvasAnimationId);
        canvasAnimationId = null;
      }
      startObsidianGraphRenderer();
    });
  }

  function startObsidianGraphRenderer() {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    setupCanvasResizeObserver();

    const wrapper = canvas.parentElement;
    const rect = wrapper ? wrapper.getBoundingClientRect() : { width: 0, height: 0 };
    const cssWidth = Math.max(rect.width || wrapper.clientWidth || 1200, 300);
    const cssHeight = Math.max(rect.height || wrapper.clientHeight || 600, 300);

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;

    const width = cssWidth;
    const height = cssHeight;

    updateFilterControlsState();

    const initialSelectedId = doubleClickedSubtreeId || focusedTaskId;
    let visibleTasks = currentTasks;

    if (initialSelectedId) {
      const activeSubtreeSet = getDescendantIds(initialSelectedId);
      const filteredTreeTasks = currentTasks.filter((t) => {
        if (!activeSubtreeSet || !activeSubtreeSet.has(t.id)) return false;
        if (currentMaxDepth !== 'all') {
          const maxRelDepth = typeof currentMaxDepth === 'number' ? currentMaxDepth : parseInt(currentMaxDepth, 10);
          const rDepth = getRelativeDepth(t, initialSelectedId);
          return rDepth !== null && rDepth <= maxRelDepth;
        }
        return true;
      });

      // Resident unscheduled isolated tasks (no parent, no children, dueDate == null)
      const residentIsolatedTasks = currentTasks.filter((t) => {
        if (t.id === initialSelectedId) return false;
        return isIsolatedTask(t) && !t.dueDate;
      });

      visibleTasks = [...filteredTreeTasks, ...residentIsolatedTasks];
    } else {
      if (currentMaxDepth !== 'all') {
        const maxDepth = typeof currentMaxDepth === 'number' ? currentMaxDepth : parseInt(currentMaxDepth, 10);
        visibleTasks = visibleTasks.filter((t) => getTaskDepth(t) < maxDepth);
      }
    }

    const initialMaxVisibleDepth = visibleTasks.reduce((max, t) => Math.max(max, getTaskDepth(t)), 0);
    const existingNodeMap = new Map(graphNodes.map((n) => [n.task.id, n]));
    const initialSugiyamaXMap = computeSugiyamaTreeXPositions(visibleTasks, width, initialSelectedId);

    graphNodes = visibleTasks.map((task, idx) => {
      const existing = existingNodeMap.get(task.id);
      if (existing) {
        existing.task = task;
        ctx.font = '11px Inter, sans-serif';
        existing.titleWidth = ctx.measureText(task.title).width;
        return existing;
      }

      const depth = getTaskDepth(task);
      const initX = initialSugiyamaXMap.get(task.id) || width / 2;
      const initY = height * computeDynamicYRatio(depth, initialMaxVisibleDepth, false);

      ctx.font = '11px Inter, sans-serif';
      const titleWidth = ctx.measureText(task.title).width;

      return {
        task,
        x: initX,
        y: initY,
        vx: 0,
        vy: 0,
        titleWidth,
        isPinned: false,
      };
    });

    const nodeMap = new Map(graphNodes.map((n) => [n.task.id, n]));

    let layoutDirty = true;
    let selectedId = null;
    let activeTreeSet = null;
    let isTimelineMode = false;
    let activeTimelineSet = null;
    let maxVisibleDepth = 0;
    let maxSubtreeRelDepth = 0;
    let sugiyamaXMap = new Map();
    let metrics = getTimelineLayoutMetrics(width);
    let dateGroups = new Map();
    let unscheduledList = [];
    let pastList = [];
    let futureList = [];
    let tasksByDepthMap = new Map();
    let today = new Date();
    today.setHours(0, 0, 0, 0);
    let settledFrames = 0;
    let idleTicks = 0;
    let lastPanOffsetX = canvasPanOffsetX;
    let lastWheelTime = 0;

    function updateTimelineSlots() {
      timelineSlotMap.clear();
      if (!isTimelineMode || !activeTimelineSet) return;

      const zone3Items = [];
      visibleTasks.forEach((t) => {
        if (activeTimelineSet.has(t.id) && t.dueDate) {
          const d = new Date(t.dueDate);
          d.setHours(0, 0, 0, 0);
          const diffDays = Math.round((d.getTime() - today.getTime()) / 86400000);
          const colX = metrics.timelineStartX + canvasPanOffsetX + (diffDays + 0.5) * metrics.dayWidth;
          if (colX >= metrics.timelineStartX && colX <= metrics.timelineEndX) {
            const n = nodeMap.get(t.id);
            const textW = (n && n.titleWidth) ? n.titleWidth : 80;
            const fullLabelW = textW + 48;
            zone3Items.push({
              id: t.id,
              colX: (draggedGraphNode && draggedGraphNode.task.id === t.id) ? draggedGraphNode.x : colX,
              diffDays,
              fullLabelW,
              orderIndex: t.orderIndex || 0,
              relDepth: getRelativeDepth(t, selectedId) ?? 0,
            });
          }
        }
      });

      // Primary sort: diffDays (date) ascending.
      // Secondary sort: colX ascending.
      // Tertiary sort: relDepth ascending (shallower / parent tasks get higher slots).
      // Quaternary sort: orderIndex ascending.
      zone3Items.sort((a, b) => a.diffDays - b.diffDays || a.colX - b.colX || a.relDepth - b.relDepth || a.orderIndex - b.orderIndex);

      const SLOT_COUNT = 7;
      const slotHeight = 20;
      const slotBaseY = 78;
      // Track list of placed intervals [left, right] in each slot
      const slotIntervals = Array.from({ length: SLOT_COUNT }, () => []);
      const placedItems = [];

      zone3Items.forEach((item) => {
        const halfW = item.fullLabelW / 2 + 5;
        const itemLeft = item.colX - halfW;
        const itemRight = item.colX + halfW;

        // Find overlapping prior items (which have earlier or equal date)
        const overlappingPrior = placedItems.filter((p) => {
          return itemLeft < p.right && itemRight > p.left;
        });

        // "上であるほど 過去の日程のものが固まる":
        // For any horizontally overlapping earlier task, this task must be placed strictly below it (greater slot index).
        const minAllowedSlot = overlappingPrior.length > 0
          ? Math.max(...overlappingPrior.map((p) => p.slot + 1))
          : 0;

        let chosenSlot = -1;

        // 1. Try finding a slot from minAllowedSlot to SLOT_COUNT - 1 with NO physical overlap
        for (let s = Math.min(minAllowedSlot, SLOT_COUNT - 1); s < SLOT_COUNT; s++) {
          const intervals = slotIntervals[s];
          const hasOverlap = intervals.some(([iLeft, iRight]) => itemLeft < iRight && itemRight > iLeft);
          if (!hasOverlap) {
            chosenSlot = s;
            break;
          }
        }

        // 2. If minAllowedSlot exceeds available slots or downstream slots are occupied,
        // find any non-overlapping slot, preferring higher slot indices to keep earlier tasks above.
        if (chosenSlot === -1) {
          for (let s = SLOT_COUNT - 1; s >= 0; s--) {
            const intervals = slotIntervals[s];
            const hasOverlap = intervals.some(([iLeft, iRight]) => itemLeft < iRight && itemRight > iLeft);
            if (!hasOverlap) {
              chosenSlot = s;
              break;
            }
          }
        }

        // 3. Fallback: if all slots collide, pick the slot with minimal overlap area
        if (chosenSlot === -1) {
          let minOverlapScore = Infinity;
          chosenSlot = SLOT_COUNT - 1;
          for (let s = 0; s < SLOT_COUNT; s++) {
            let totalOverlap = 0;
            for (const [iLeft, iRight] of slotIntervals[s]) {
              const overlap = Math.max(0, Math.min(itemRight, iRight) - Math.max(itemLeft, iLeft));
              totalOverlap += overlap;
            }
            if (totalOverlap < minOverlapScore) {
              minOverlapScore = totalOverlap;
              chosenSlot = s;
            }
          }
        }

        // Target LX is ALWAYS strictly colX (directly under the date column, NO diagonal shift!)
        const targetLX = item.colX;
        const targetLY = slotBaseY + chosenSlot * slotHeight;

        slotIntervals[chosenSlot].push([itemLeft, itemRight]);
        placedItems.push({
          id: item.id,
          diffDays: item.diffDays,
          colX: item.colX,
          left: itemLeft,
          right: itemRight,
          slot: chosenSlot,
        });

        timelineSlotMap.set(item.id, {
          slot: chosenSlot,
          lx: targetLX,
          ly: targetLY,
        });
      });
    }

    function updateLayoutState() {
      selectedId = doubleClickedSubtreeId || focusedTaskId;
      activeTreeSet = selectedId ? getDescendantIds(selectedId) : null;
      isTimelineMode = Boolean(selectedId && activeTreeSet);
      activeTimelineSet = isTimelineMode ? new Set(activeTreeSet || []) : null;
      if (isTimelineMode && activeTimelineSet) {
        visibleTasks.forEach((t) => {
          if (isIsolatedTask(t) && !t.dueDate) {
            activeTimelineSet.add(t.id);
          }
        });
      }
      maxVisibleDepth = visibleTasks.reduce((max, t) => Math.max(max, getTaskDepth(t)), 0);
      sugiyamaXMap = computeSugiyamaTreeXPositions(visibleTasks, width, selectedId);
      metrics = getTimelineLayoutMetrics(width);

      today = new Date();
      today.setHours(0, 0, 0, 0);

      dateGroups = new Map();
      unscheduledList = [];
      pastList = [];
      futureList = [];

      if (isTimelineMode) {
        visibleTasks.forEach((t) => {
          if (activeTimelineSet.has(t.id)) {
            if (t.dueDate) {
              const d = new Date(t.dueDate);
              d.setHours(0, 0, 0, 0);
              const diffDays = Math.round((d.getTime() - today.getTime()) / 86400000);
              const colX = metrics.timelineStartX + canvasPanOffsetX + (diffDays + 0.5) * metrics.dayWidth;
              if (colX < metrics.timelineStartX) {
                pastList.push(t.id);
              } else if (colX > metrics.timelineEndX) {
                futureList.push(t.id);
              } else {
                const key = d.getTime();
                if (!dateGroups.has(key)) dateGroups.set(key, []);
                dateGroups.get(key).push(t.id);
              }
            } else {
              unscheduledList.push(t.id);
            }
          }
        });

        const sortTaskIds = (ids) => {
          ids.sort((a, b) => {
            const taskA = currentTasks.find((t) => t.id === a);
            const taskB = currentTasks.find((t) => t.id === b);
            const isTreeA = activeTreeSet && activeTreeSet.has(a);
            const isTreeB = activeTreeSet && activeTreeSet.has(b);
            if (isTreeA && !isTreeB) return -1;
            if (!isTreeA && isTreeB) return 1;
            const rA = taskA ? getRelativeDepth(taskA, selectedId) ?? 0 : 0;
            const rB = taskB ? getRelativeDepth(taskB, selectedId) ?? 0 : 0;
            if (rA !== rB) return rA - rB;
            return (taskA?.orderIndex || 0) - (taskB?.orderIndex || 0);
          });
        };
        sortTaskIds(unscheduledList);
        sortTaskIds(pastList);
        sortTaskIds(futureList);
        dateGroups.forEach((ids) => sortTaskIds(ids));

        updateTimelineSlots();
      } else {
        timelineSlotMap.clear();
      }

      maxSubtreeRelDepth = 0;
      if (selectedId && activeTreeSet) {
        visibleTasks.forEach((t) => {
          if (activeTreeSet.has(t.id)) {
            const rDepth = getRelativeDepth(t, selectedId);
            if (rDepth !== null) {
              maxSubtreeRelDepth = Math.max(maxSubtreeRelDepth, rDepth);
            }
          }
        });
      }

      tasksByDepthMap = new Map();
      visibleTasks.forEach((t) => {
        const d = getTaskDepth(t);
        if (!tasksByDepthMap.has(d)) tasksByDepthMap.set(d, []);
        tasksByDepthMap.get(d).push(t);
      });
      tasksByDepthMap.forEach((tasksAtDepth) => {
        tasksAtDepth.sort((a, b) => (sugiyamaXMap.get(a.id) || 0) - (sugiyamaXMap.get(b.id) || 0));
      });

      layoutDirty = false;
    }

    updateLayoutState();

    function wakeAnimation() {
      idleTicks = 0;
      settledFrames = 0;
      if (!canvasAnimationId) {
        canvasAnimationId = requestAnimationFrame(animate);
      }
    }
    canvas.__wakeAnimation = wakeAnimation;

    function animate() {
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      const isLight = document.documentElement.getAttribute('data-theme') === 'light';

      // Draw subtle background grid
      ctx.strokeStyle = isLight ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255, 255, 255, 0.04)';
      ctx.lineWidth = 1;
      const gridSize = 40;
      for (let x = 0; x < width; x += gridSize) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
      }
      for (let y = 0; y < height; y += gridSize) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      }

      // Draw top in-canvas dropzone strip for drag-to-root
      if (draggedGraphNode && draggedGraphNode.task.parentId) {
        ctx.fillStyle = draggedGraphNode.y <= 60 ? (isLight ? 'rgba(16, 185, 129, 0.15)' : 'rgba(16, 185, 129, 0.25)') : (isLight ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.05)');
        ctx.strokeStyle = draggedGraphNode.y <= 60 ? '#10b981' : (isLight ? '#cbd5e1' : '#3f3f46');
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.fillRect(20, 10, width - 40, 50);
        ctx.strokeRect(20, 10, width - 40, 50);
        ctx.setLineDash([]);

        ctx.font = 'bold 13px Inter, sans-serif';
        ctx.fillStyle = draggedGraphNode.y <= 60 ? '#10b981' : (isLight ? '#64748b' : '#a1a1aa');
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('[ ここにドロップでルート要素 (親なし) に昇格 ]', width / 2, 35);
      }

      if (layoutDirty || isPanningCanvas || draggedGraphNode || canvasPanOffsetX !== lastPanOffsetX) {
        updateLayoutState();
        lastPanOffsetX = canvasPanOffsetX;
      }

      const isInspectorOpen = obsidianInspector && !obsidianInspector.classList.contains('hidden');

      // If Timeline Mode (Element Clicked): Render top Date Axis
      if (isTimelineMode) {
        drawCanvasDateAxis(ctx, width, height, isLight);
      }

      graphNodes.forEach((node) => {
        if (!node.isPinned) {
          if (isTimelineMode && activeTimelineSet.has(node.task.id)) {
            let targetX;
            if (node.task.dueDate) {
              const dObj = new Date(node.task.dueDate);
              dObj.setHours(0, 0, 0, 0);
              const diffDays = Math.round((dObj.getTime() - today.getTime()) / 86400000);
              const colX = metrics.timelineStartX + canvasPanOffsetX + (diffDays + 0.5) * metrics.dayWidth;
              if (colX < metrics.timelineStartX) {
                targetX = metrics.zone2Center;
              } else if (colX > metrics.timelineEndX) {
                targetX = metrics.zone4Center;
              } else {
                targetX = colX;
              }
            } else {
              targetX = metrics.zone1Center;
            }
            node.vx += (targetX - node.x) * 0.085;
          } else {
            const targetX = sugiyamaXMap.get(node.task.id);
            if (targetX !== undefined) {
              const isSubtreeNode = activeTreeSet && activeTreeSet.has(node.task.id);
              const springK = isSubtreeNode ? 0.065 : 0.055;
              node.vx += (targetX - node.x) * springK;
            }
          }
        }
      });

      const minRepelDist = 55;
      for (let i = 0; i < graphNodes.length; i++) {
        for (let j = i + 1; j < graphNodes.length; j++) {
          const nodeA = graphNodes[i];
          const nodeB = graphNodes[j];
          if (nodeA.isPinned || nodeB.isPinned) continue;

          const dx = nodeB.x - nodeA.x;
          const dy = nodeB.y - nodeA.y;
          const dist = Math.hypot(dx, dy) || 1;

          // 1. Center Circle Repulsion
          if (dist < minRepelDist) {
            const force = ((minRepelDist - dist) / minRepelDist) * 0.4;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;

            nodeA.vx -= fx;
            nodeA.vy -= fy;
            nodeB.vx += fx;
            nodeB.vy += fy;
          }

          // 2. Strict vertical clearance for nodes in the same date column
          if (isTimelineMode && activeTimelineSet && activeTimelineSet.has(nodeA.task.id) && activeTimelineSet.has(nodeB.task.id)) {
            if (Math.abs(dx) < 24) {
              const minDistY = 50;
              const curDistY = Math.abs(dy);
              if (curDistY < minDistY) {
                const pushY = ((minDistY - curDistY) / minDistY) * 1.5;
                const sign = dy >= 0 ? 1 : -1;
                nodeA.vy -= sign * pushY;
                nodeB.vy += sign * pushY;
              }
            }
          }

          // 3. Sibling & Text Label Overlap Prevention (vertical only, normal mode only)
          if (!isTimelineMode) {
            const textWA = nodeA.titleWidth || 80;
            const textWB = nodeB.titleWidth || 80;

            const reqLabelWidth = (textWA + textWB) / 2 + 16;
            const reqLabelHeight = 44;

            const absDx = Math.abs(dx);
            const absDy = Math.abs(dy);

            if (absDx < reqLabelWidth && absDy < reqLabelHeight) {
              const overlapX = (reqLabelWidth - absDx) / reqLabelWidth;
              const overlapY = (reqLabelHeight - absDy) / reqLabelHeight;
              const repelStrength = Math.min(overlapX, overlapY) * 0.35;
              const signY = dy >= 0 ? 1 : -1;

              nodeA.vy -= signY * overlapY * repelStrength;
              nodeB.vy += signY * overlapY * repelStrength;
            }
          }
        }
      }

      // Physics Repulsion Shield from Inspector Bottom Modal
      if (isInspectorOpen) {
        const inspectorCenterX = width / 2;
        const inspectorTopY = height - 170;
        graphNodes.forEach((node) => {
          if (Math.abs(node.x - inspectorCenterX) < 360 && node.y > inspectorTopY) {
            node.vy -= Math.max(2.0, (node.y - inspectorTopY) * 0.25);
          }
        });
      }

      const nowTime = Date.now() * 0.0012;
      graphNodes.forEach((node, idx) => {
        if (!node.isPinned) {
          let targetY;

          if (isTimelineMode && activeTimelineSet.has(node.task.id)) {
            const relDepth = getRelativeDepth(node.task, selectedId) ?? 0;
            if (node.task.dueDate) {
              const dObj = new Date(node.task.dueDate);
              dObj.setHours(0, 0, 0, 0);
              const diffDays = Math.round((dObj.getTime() - today.getTime()) / 86400000);
              const colX = metrics.timelineStartX + canvasPanOffsetX + (diffDays + 0.5) * metrics.dayWidth;
              if (colX < metrics.timelineStartX) {
                const pIdx = Math.max(0, pastList.indexOf(node.task.id));
                targetY = 228 + pIdx * 50;
              } else if (colX > metrics.timelineEndX) {
                const fIdx = Math.max(0, futureList.indexOf(node.task.id));
                targetY = 228 + fIdx * 50;
              } else {
                // Zone 3: Timeline Area (Lower tier for graph nodes & arrows)
                const lowerTierTopY = 228;
                const maxRel = Math.max(1, maxSubtreeRelDepth);
                const availH = (isInspectorOpen ? (height - 180) : (height - 85)) - lowerTierTopY;
                const stepY = Math.min(85, Math.max(48, availH / Math.max(1, maxRel)));

                const list = dateGroups.get(dObj.getTime()) || [node.task.id];
                const sameDepthTasks = list.filter((id) => {
                  const t = currentTasks.find((x) => x.id === id);
                  return (t ? (getRelativeDepth(t, selectedId) ?? 0) : 0) === relDepth;
                });
                const siblingOffsetIdx = Math.max(0, sameDepthTasks.indexOf(node.task.id));
                targetY = lowerTierTopY + relDepth * stepY + siblingOffsetIdx * 45;
              }
            } else {
              const uIdx = Math.max(0, unscheduledList.indexOf(node.task.id));
              targetY = 228 + uIdx * 50;
            }
            const hierarchicalGravityY = (targetY - node.y) * 0.07;
            node.vy += hierarchicalGravityY;
          } else if (selectedId && activeTreeSet) {
            // Unfocused background nodes sink slightly (+0.04) to highlight selected subtree
            const depth = getTaskDepth(node.task);
            const targetYRatio = Math.min(0.92, computeDynamicYRatio(depth, maxVisibleDepth, false, isInspectorOpen) + 0.04);
            targetY = height * targetYRatio;
            const hierarchicalGravityY = (targetY - node.y) * 0.04;
            node.vy += hierarchicalGravityY;
          } else {
            // Normal view with dynamic vertical scaling according to maxVisibleDepth
            const depth = getTaskDepth(node.task);
            const targetYRatio = computeDynamicYRatio(depth, maxVisibleDepth, false, isInspectorOpen);
            let targetY = height * targetYRatio;

            // Stagger dense layers in 2 tiers to prevent horizontal label collision
            const tasksAtDepth = tasksByDepthMap.get(depth);
            if (tasksAtDepth && tasksAtDepth.length >= 2) {
              const depthIdx = tasksAtDepth.findIndex((t) => t.id === node.task.id);
              if (depthIdx >= 0) {
                const staggerAmount = currentFontSizeMode === 'large' ? 28 : (currentFontSizeMode === 'small' ? 14 : 18);
                const isTopTier = depthIdx % 2 === 0;
                targetY += (isTopTier ? -staggerAmount : staggerAmount);
                node.labelPosition = isTopTier ? 'top' : 'bottom';
              } else {
                node.labelPosition = 'bottom';
              }
            } else {
              node.labelPosition = 'bottom';
            }

            const hierarchicalGravityY = (targetY - node.y) * 0.055;
            node.vy += hierarchicalGravityY;
          }

          // Subtle organic drift that smoothly fades as physics settles
          const isNodeActive = activeTimelineSet && activeTimelineSet.has(node.task.id);
          const driftFactor = Math.max(0, 1 - idleTicks / 60);
          const driftMult = (isNodeActive ? (isTimelineMode ? 0 : 0.005) : 0.02) * driftFactor;
          const driftX = Math.cos(nowTime * 0.8 + idx * 1.5) * driftMult;
          const driftY = Math.sin(nowTime * 0.7 + idx * 2.1) * driftMult;

          node.vx += driftX;
          node.vy += driftY;

          // Strong velocity damping prevents oscillation & wobble
          node.vx *= 0.78;
          node.vy *= 0.78;

          node.x += node.vx;
          node.y += node.vy;

          const pad = 35;
          if (node.x < pad) { node.x = pad; node.vx *= -0.5; }
          if (node.x > width - pad) { node.x = width - pad; node.vx *= -0.5; }
          if (node.y < pad) { node.y = pad; node.vy *= -0.5; }
          if (node.y > height - pad) { node.y = height - pad; node.vy *= -0.5; }
        }
      });

      // Draw Edges
      graphNodes.forEach((node) => {
        if (node.task.parentId) {
          const parentNode = nodeMap.get(node.task.parentId);
          if (parentNode) {
            const isSubtreeEdge = isTimelineMode
              ? Boolean(activeTreeSet && activeTreeSet.has(node.task.id) && activeTreeSet.has(parentNode.task.id))
              : true;
            const isDimmedEdge = isTimelineMode && Boolean(activeTreeSet) && !isSubtreeEdge;

            // Check if this edge belongs to the active lineage (hovered or focused node)
            const activeLineageId = hoveredNodeId || focusedTaskId;
            const isLineageEdge = Boolean(
              activeLineageId &&
              (node.task.id === activeLineageId || parentNode.task.id === activeLineageId)
            );

            const dx = parentNode.x - node.x;
            const dy = parentNode.y - node.y;

            ctx.save();

            if (isTimelineMode && isSubtreeEdge) {
              // Straight line edge connection for timeline mode (Parent -> Child)
              const metrics = getTimelineLayoutMetrics(width);
              const isNodeOutside = node.x < metrics.timelineStartX || node.x > metrics.timelineEndX;
              const isParentOutside = parentNode.x < metrics.timelineStartX || parentNode.x > metrics.timelineEndX;
              const isCrossZone = isNodeOutside || isParentOutside;

              ctx.beginPath();
              ctx.moveTo(parentNode.x, parentNode.y);
              ctx.lineTo(node.x, node.y);

              let edgeColor = '#f59e0b';
              let edgeWidth = 2.2;

              if (isCrossZone) {
                edgeColor = isLight ? 'rgba(217, 119, 6, 0.45)' : 'rgba(245, 158, 11, 0.48)';
                edgeWidth = 1.6;
                ctx.setLineDash([5, 4]);
              } else {
                ctx.setLineDash([]);
              }

              if (isLineageEdge) {
                edgeColor = '#f59e0b';
                edgeWidth = 3.2;
                ctx.shadowColor = '#f59e0b';
                ctx.shadowBlur = 10;
              } else if (activeLineageId) {
                ctx.globalAlpha = 0.25;
              }

              ctx.strokeStyle = edgeColor;
              ctx.lineWidth = edgeWidth;
              ctx.stroke();
              ctx.setLineDash([]);

              // Directional arrow on straight edge pointing Parent -> Child
              const dist = Math.hypot(node.x - parentNode.x, node.y - parentNode.y) || 1;
              if (dist > 35) {
                const sux = (node.x - parentNode.x) / dist;
                const suy = (node.y - parentNode.y) / dist;
                const snx = -suy;
                const sny = sux;
                const sax = parentNode.x + (node.x - parentNode.x) * 0.6;
                const say = parentNode.y + (node.y - parentNode.y) * 0.6;

                ctx.beginPath();
                ctx.moveTo(sax + sux * 4, say + suy * 4);
                ctx.lineTo(sax - sux * 6 + snx * 3.5, say - suy * 6 + sny * 3.5);
                ctx.lineTo(sax - sux * 6 - snx * 3.5, say - suy * 6 - sny * 3.5);
                ctx.closePath();
                ctx.fillStyle = edgeColor;
                ctx.fill();
              }

            } else {
              // Standard graph edge (Parent -> Child)
              ctx.beginPath();
              ctx.moveTo(parentNode.x, parentNode.y);
              ctx.lineTo(node.x, node.y);

              let edgeColor = (isTimelineMode && isSubtreeEdge)
                ? '#f59e0b'
                : (isLight ? 'rgba(100, 116, 139, 0.65)' : 'rgba(255, 255, 255, 0.45)');
              let edgeWidth = (isTimelineMode && isSubtreeEdge) ? 2.5 : 1.6;

              if (isLineageEdge) {
                edgeColor = '#f59e0b';
                edgeWidth = 3.2;
                ctx.shadowColor = '#f59e0b';
                ctx.shadowBlur = 10;
              } else if (activeLineageId) {
                ctx.globalAlpha = 0.25;
              } else if (isDimmedEdge) {
                ctx.globalAlpha = 0.12;
              } else {
                ctx.globalAlpha = 1.0;
              }

              ctx.strokeStyle = edgeColor;
              ctx.lineWidth = edgeWidth;
              ctx.setLineDash((isTimelineMode && !isSubtreeEdge) ? [4, 4] : []);
              ctx.stroke();
              ctx.setLineDash([]);

              // Directional arrow on straight edge pointing Parent -> Child
              const dist = Math.hypot(node.x - parentNode.x, node.y - parentNode.y) || 1;
              if (dist > 35) {
                const sux = (node.x - parentNode.x) / dist;
                const suy = (node.y - parentNode.y) / dist;
                const snx = -suy;
                const sny = sux;
                const sax = parentNode.x + (node.x - parentNode.x) * 0.6;
                const say = parentNode.y + (node.y - parentNode.y) * 0.6;

                ctx.beginPath();
                ctx.moveTo(sax + sux * 4, say + suy * 4);
                ctx.lineTo(sax - sux * 6 + snx * 3.5, say - suy * 6 + sny * 3.5);
                ctx.lineTo(sax - sux * 6 - snx * 3.5, say - suy * 6 - sny * 3.5);
                ctx.closePath();
                ctx.fillStyle = edgeColor;
                ctx.fill();
              }
            }

            ctx.restore();
          }
        }
      });


      // Draw Upward Link Line & Badge if doubleClickedSubtreeId has a parent
      if (doubleClickedSubtreeId) {
        const focusNode = nodeMap.get(doubleClickedSubtreeId);
        if (focusNode && focusNode.task.parentId) {
          const parentTask = currentTasks.find((t) => t.id === focusNode.task.parentId);
          const parentTitle = parentTask ? parentTask.title : '親タスク';

          ctx.save();
          const topTargetY = Math.max(25, focusNode.y - 70);

          ctx.beginPath();
          ctx.moveTo(focusNode.x, focusNode.y - 14);
          ctx.lineTo(focusNode.x, topTargetY);
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 2.5;
          ctx.setLineDash([5, 5]);
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.fillStyle = '#f59e0b';
          ctx.beginPath();
          ctx.arc(focusNode.x, topTargetY, 13, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 12px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('↑', focusNode.x, topTargetY);

          ctx.font = '600 11px Inter, sans-serif';
          ctx.fillStyle = isLight ? '#18181b' : '#f4f4f5';
          ctx.fillText(`親: ${parentTitle}`, focusNode.x, topTargetY - 18);
          ctx.restore();
        }
      }

        // Draw Leader Line helper (Canvas 2D: node top anchor -> label plate bottom anchor)
      function drawLeaderLine(ctx, node, isHighlighted, isLight) {
        const slotInfo = timelineSlotMap.get(node.task.id);
        if (!slotInfo) return;

        const childCount = currentTasks.filter((t) => t.parentId === node.task.id).length;
        const baseRadius = 9;
        const coreRadius = baseRadius + Math.min(childCount * 4, 16);

        const fontSize = getGraphFontSize(selectedId === node.task.id);
        const plateHeight = fontSize + 4;

        // Perfectly vertical leader line: startX === endX === lineX (zero diagonal tilt)
        const lineX = (node.labelX !== undefined) ? node.labelX : node.x;
        const startY = node.y - coreRadius;
        const endY = (node.labelY !== undefined ? node.labelY : slotInfo.ly) + plateHeight / 2;

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(lineX, startY);
        ctx.lineTo(lineX, endY);

        if (isHighlighted) {
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 2.0;
          ctx.setLineDash([]);
          ctx.shadowColor = '#f59e0b';
          ctx.shadowBlur = 10;
        } else {
          ctx.strokeStyle = isLight ? 'rgba(0, 0, 0, 0.22)' : 'rgba(255, 255, 255, 0.25)';
          ctx.lineWidth = 1.0;
          ctx.setLineDash([3, 3]);
          ctx.shadowBlur = 0;
        }
        ctx.stroke();
        ctx.setLineDash([]);

        // Origin dot at node circle top
        ctx.beginPath();
        ctx.arc(lineX, startY, isHighlighted ? 2.8 : 2.0, 0, Math.PI * 2);
        ctx.fillStyle = isHighlighted
          ? '#f59e0b'
          : (isLight ? 'rgba(0, 0, 0, 0.35)' : 'rgba(255, 255, 255, 0.45)');
        ctx.fill();

        ctx.restore();
      }

      // Draw Standard Leader Lines for Zone 3 timeline nodes (rendered beneath node circles and plates)
      if (isTimelineMode && activeTimelineSet) {
        graphNodes.forEach((node) => {
          if (timelineSlotMap.has(node.task.id)) {
            const isNodeHovered = (hoveredNodeId === node.task.id);
            if (!isNodeHovered) {
              drawLeaderLine(ctx, node, false, isLight);
            }
          }
        });
      }

      // Draw Nodes (sorted so hovered/closest node is rendered last, i.e., on top of z-axis)
      const sortedNodes = [...graphNodes].sort((a, b) => {
        const aIsHovered = a.task.id === hoveredNodeId;
        const bIsHovered = b.task.id === hoveredNodeId;
        if (aIsHovered && !bIsHovered) return 1;
        if (!aIsHovered && bIsHovered) return -1;

        const aIsSelected = a.task.id === selectedId;
        const bIsSelected = b.task.id === selectedId;
        if (aIsSelected && !bIsSelected) return 1;
        if (!aIsSelected && bIsSelected) return -1;

        return 0;
      });

      sortedNodes.forEach((node) => {
        let nodeColor = isLight ? '#64748b' : '#a1a1aa';
        if (node.task.status === 'IN_PROGRESS') nodeColor = '#f59e0b';
        if (node.task.status === 'DONE') nodeColor = '#10b981';

        const isSelectedRoot = selectedId === node.task.id;
        const isInspectorSelected = inspectorSelectedTaskId === node.task.id;
        const isHovered = hoveredNodeId === node.task.id;
        const isInSubtree = isTimelineMode ? (activeTimelineSet ? activeTimelineSet.has(node.task.id) : true) : true;
        const isDimmed = isTimelineMode && Boolean(activeTimelineSet) && !isInSubtree;

        const childCount = currentTasks.filter((t) => t.parentId === node.task.id).length;
        const baseRadius = 9;
        const coreRadius = baseRadius + Math.min(childCount * 4, 16);
        const haloRadius = coreRadius + (isSelectedRoot ? 12 : (isInspectorSelected ? 11 : (isHovered ? 10 : (isTimelineMode && isInSubtree ? 8 : 5))));

        // Frontmost glowing leader line for hovered Zone 3 node
        if (isHovered && timelineSlotMap.has(node.task.id)) {
          drawLeaderLine(ctx, node, true, isLight);
        }

        ctx.globalAlpha = isDimmed ? 0.2 : 1.0;

        // Halo
        ctx.beginPath();
        ctx.arc(node.x, node.y, haloRadius, 0, Math.PI * 2);
        ctx.fillStyle = isSelectedRoot ? '#f59e0b' : (isInspectorSelected ? '#38bdf8' : nodeColor);
        ctx.globalAlpha = isDimmed ? 0.08 : (isSelectedRoot ? 0.45 : (isInspectorSelected ? 0.38 : (isHovered ? 0.35 : 0.22)));
        ctx.fill();

        // Core Circle
        ctx.beginPath();
        ctx.arc(node.x, node.y, coreRadius, 0, Math.PI * 2);
        ctx.globalAlpha = isDimmed ? 0.25 : 1.0;
        ctx.fillStyle = nodeColor;
        ctx.fill();

        ctx.strokeStyle = isSelectedRoot
          ? (isLight ? '#18181b' : '#ffffff')
          : (isInspectorSelected ? '#38bdf8' : (isHovered ? '#f59e0b' : (isLight ? 'rgba(0, 0, 0, 0.25)' : 'rgba(255, 255, 255, 0.35)')));
        ctx.lineWidth = (isSelectedRoot || isInspectorSelected || isHovered) ? 2.8 : 1.6;
        ctx.stroke();

        if (childCount > 0) {
          ctx.font = 'bold 10px Inter, sans-serif';
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`${childCount}`, node.x, node.y);
          ctx.textBaseline = 'alphabetic';
        }

        // Label with background plate scaled to current font size selection
        const fontSize = getGraphFontSize(isSelectedRoot);
        const fontWeight = (isSelectedRoot || isHovered) ? '600' : (isInSubtree && activeTimelineSet ? '500' : '400');
        ctx.font = `${fontWeight} ${fontSize}px Inter, sans-serif`;

        let labelText = node.task.title;
        let timelineZone = 'none'; // 'unscheduled', 'past', 'timeline', 'future'
        if (isTimelineMode && isInSubtree) {
          if (!node.task.dueDate) {
            labelText = `[未設定] ${node.task.title}`;
            timelineZone = 'unscheduled';
          } else {
            const d = new Date(node.task.dueDate);
            d.setHours(0, 0, 0, 0);
            const diffDays = Math.round((d.getTime() - today.getTime()) / 86400000);
            const colX = metrics.timelineStartX + canvasPanOffsetX + (diffDays + 0.5) * metrics.dayWidth;
            const m = d.getMonth() + 1;
            const dayNum = d.getDate();
            if (colX < metrics.timelineStartX) {
              labelText = `[${m}/${dayNum} 過去] ${node.task.title}`;
              timelineZone = 'past';
            } else if (colX > metrics.timelineEndX) {
              labelText = `[${m}/${dayNum} 未来] ${node.task.title}`;
              timelineZone = 'future';
            } else {
              labelText = `[${m}/${dayNum}] ${node.task.title}`;
              timelineZone = 'timeline';
            }
          }
        }

        const textMetrics = ctx.measureText(labelText);
        const textWidth = textMetrics.width;
        const plateHeight = fontSize + 4;

        // Label position:
        // - future (Zone 4 right edge): left of node circle
        // - past (Zone 2) / unscheduled (Zone 1 left edge): right of node circle
        // - timeline (Zone 3 upper slot area): top multi-tier slot
        // - normal mode: bottom of node circle
        let targetLX, targetLY;
        const platePad = 8;
        if (timelineZone === 'future') {
          targetLX = node.x - haloRadius - 8;
          targetLY = node.y;
          targetLX = Math.max(platePad + textWidth + 4, targetLX);
        } else if (timelineZone === 'past' || timelineZone === 'unscheduled') {
          targetLX = node.x + haloRadius + 8;
          targetLY = node.y;
          targetLX = Math.min(width - platePad - textWidth - 4, targetLX);
        } else if (timelineZone === 'timeline') {
          const slotInfo = timelineSlotMap.get(node.task.id);
          if (slotInfo) {
            targetLX = slotInfo.lx;
            targetLY = slotInfo.ly;
          } else {
            targetLX = node.x;
            targetLY = 78;
          }
        } else {
          targetLX = node.x;
          let prefPos = node.labelPosition || 'bottom';
          // Upper/lower canvas boundary checks
          if (prefPos === 'top' && (node.y - haloRadius - plateHeight) < 45) {
            prefPos = 'bottom';
          } else if (prefPos === 'bottom' && (node.y + haloRadius + plateHeight) > (height - 65)) {
            prefPos = 'top';
          }

          if (prefPos === 'top') {
            targetLY = node.y - haloRadius - plateHeight / 2 - 4;
          } else {
            targetLY = node.y + haloRadius + plateHeight / 2 + 4;
          }
          const halfW = textWidth / 2 + 4;
          targetLX = Math.max(platePad + halfW, Math.min(width - platePad - halfW, targetLX));
        }

        if (node.labelX === undefined) node.labelX = targetLX;
        if (node.labelY === undefined) node.labelY = targetLY;
        if (node.labelVx === undefined) node.labelVx = 0;
        if (node.labelVy === undefined) node.labelVy = 0;

        const springK = 0.55;
        const springDamp = 0.45;

        const ax = (targetLX - node.labelX) * springK;
        const ay = (targetLY - node.labelY) * springK;

        node.labelVx = (node.labelVx + ax) * springDamp;
        node.labelVy = (node.labelVy + ay) * springDamp;

        node.labelX += node.labelVx;
        node.labelY += node.labelVy;

        // Visual screen boundary clamp for labels so text never extends off-screen
        if (timelineZone === 'future') {
          if (node.labelX - textWidth - 4 < platePad) {
            node.labelX = platePad + textWidth + 4;
            node.labelVx = 0;
          }
        } else if (timelineZone === 'past' || timelineZone === 'unscheduled') {
          if (node.labelX + textWidth + 4 > width - platePad) {
            node.labelX = width - platePad - textWidth - 4;
            node.labelVx = 0;
          }
        } else if (timelineZone === 'timeline') {
          const halfW = textWidth / 2 + 4;
          if (node.labelX - halfW < platePad) {
            node.labelX = platePad + halfW;
            node.labelVx = 0;
          } else if (node.labelX + halfW > width - platePad) {
            node.labelX = width - platePad - halfW;
            node.labelVx = 0;
          }
        } else {
          const halfW = textWidth / 2 + 4;
          if (node.labelX - halfW < platePad) {
            node.labelX = platePad + halfW;
            node.labelVx = 0;
          } else if (node.labelX + halfW > width - platePad) {
            node.labelX = width - platePad - halfW;
            node.labelVx = 0;
          }
        }

        const lx = node.labelX;
        const ly = node.labelY;

        const isLabelHidden =
          (timelineZone === 'past' && !showPastLabels && !isHovered) ||
          (timelineZone === 'future' && !showFutureLabels && !isHovered);

        if (!isLabelHidden) {
          // Label Background Plate rendered at physical label coordinates (lx, ly)
          ctx.save();
          if (isHovered) {
            ctx.shadowColor = (timelineZone === 'timeline') ? '#f59e0b' : (isLight ? 'rgba(0, 0, 0, 0.28)' : 'rgba(0, 0, 0, 0.7)');
            ctx.shadowBlur = 12;
            ctx.shadowOffsetY = (timelineZone === 'timeline') ? 0 : 2;
          }

          ctx.fillStyle = isLight ? 'rgba(255, 255, 255, 0.98)' : 'rgba(20, 20, 26, 0.96)';
          ctx.globalAlpha = isDimmed ? 0.2 : (isHovered ? 1.0 : 0.96);
          ctx.strokeStyle = isHovered
            ? '#f59e0b'
            : (isSelectedRoot
                ? 'rgba(245, 158, 11, 0.85)'
                : (isInspectorSelected
                    ? (isLight ? '#0284c7' : '#38bdf8')
                    : (isLight ? 'rgba(0, 0, 0, 0.16)' : 'rgba(255, 255, 255, 0.22)')));
          ctx.lineWidth = (isHovered || isSelectedRoot || isInspectorSelected) ? 2.0 : 1;

          if (timelineZone === 'future') {
            ctx.beginPath();
            if (ctx.roundRect) {
              ctx.roundRect(lx - textWidth - 4, ly - plateHeight / 2, textWidth + 8, plateHeight, 4);
            } else {
              ctx.rect(lx - textWidth - 4, ly - plateHeight / 2, textWidth + 8, plateHeight);
            }
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = isDimmed ? (isLight ? '#94a3b8' : '#52525b') : (isLight ? '#18181b' : '#f4f4f5');
            ctx.globalAlpha = isDimmed ? 0.3 : 1.0;
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText(labelText, lx, ly);
          } else if (timelineZone === 'past' || timelineZone === 'unscheduled') {
            ctx.beginPath();
            if (ctx.roundRect) {
              ctx.roundRect(lx - 4, ly - plateHeight / 2, textWidth + 8, plateHeight, 4);
            } else {
              ctx.rect(lx - 4, ly - plateHeight / 2, textWidth + 8, plateHeight);
            }
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = isDimmed ? (isLight ? '#94a3b8' : '#52525b') : (isLight ? '#18181b' : '#f4f4f5');
            ctx.globalAlpha = isDimmed ? 0.3 : 1.0;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(labelText, lx, ly);
          } else {
            const isTimelineSlot = (timelineZone === 'timeline');
            ctx.beginPath();
            if (ctx.roundRect) {
              ctx.roundRect(lx - textWidth / 2 - 5, ly - plateHeight / 2, textWidth + 10, plateHeight, isTimelineSlot ? 5 : 4);
            } else {
              ctx.rect(lx - textWidth / 2 - 5, ly - plateHeight / 2, textWidth + 10, plateHeight);
            }
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = isDimmed
              ? (isLight ? '#94a3b8' : '#52525b')
              : (isHovered && isTimelineSlot
                  ? (isLight ? '#b45309' : '#fef3c7')
                  : (isLight ? '#18181b' : '#f4f4f5'));
            ctx.globalAlpha = isDimmed ? 0.3 : 1.0;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(labelText, lx, ly);
          }
          ctx.restore();
          ctx.globalAlpha = 1.0;
        }
      });

      // Draw live date-drop tooltip when dragging node in timeline mode
      if (draggedGraphNode && isTimelineMode) {
        let tooltipText = '';
        let tooltipBg = '#18181b';
        let tooltipFg = '#ffffff';

        if (draggedGraphNode.x < metrics.zone2Start) {
          tooltipText = '📅 期日を未設定にする';
          tooltipBg = isLight ? '#475569' : '#334155';
        } else if (draggedGraphNode.x > metrics.zone4Start) {
          const targetDate = new Date(today.getTime() + currentDaysRange * 86400000);
          const m = targetDate.getMonth() + 1;
          const d = targetDate.getDate();
          tooltipText = `📅 未来の期日 (${m}/${d} 以降)`;
          tooltipBg = '#4f46e5';
        } else {
          const diffDays = Math.round((draggedGraphNode.x - (metrics.timelineStartX + canvasPanOffsetX)) / metrics.dayWidth);
          const targetDate = new Date(today.getTime() + diffDays * 86400000);
          const m = targetDate.getMonth() + 1;
          const d = targetDate.getDate();
          const dayOfWeekStr = ['日', '月', '火', '水', '木', '金', '土'][targetDate.getDay()];
          if (diffDays < 0) {
            tooltipText = `📅 完了予定日: ${m}/${d}(${dayOfWeekStr}) [過去]`;
            tooltipBg = '#ef4444';
          } else {
            tooltipText = `📅 完了予定日: ${m}/${d}(${dayOfWeekStr}) [${diffDays === 0 ? '今日' : `+${diffDays}日`}]`;
            tooltipBg = diffDays === 0 ? '#10b981' : '#f59e0b';
          }
        }

        ctx.save();
        ctx.font = 'bold 12px Inter, sans-serif';
        const tw = ctx.measureText(tooltipText).width;
        const th = 26;
        const pillW = tw + 22;
        const tipX = Math.max(pillW / 2 + 10, Math.min(width - pillW / 2 - 10, draggedGraphNode.x));
        const tipY = Math.max(th + 10, draggedGraphNode.y - 36);

        ctx.shadowColor = 'rgba(0, 0, 0, 0.28)';
        ctx.shadowBlur = 8;
        ctx.shadowOffsetY = 3;

        ctx.fillStyle = tooltipBg;
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(tipX - pillW / 2, tipY - th / 2, pillW, th, 13);
        } else {
          ctx.rect(tipX - pillW / 2, tipY - th / 2, pillW, th);
        }
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
        ctx.fillStyle = tooltipFg;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(tooltipText, tipX, tipY);
        ctx.restore();
      }

      // Draw tooltip when hovering over eye buttons in timeline mode
      if (hoveredEyeZone && isTimelineMode && !draggedGraphNode) {
        const isPast = hoveredEyeZone === 'past';
        const isShown = isPast ? showPastLabels : showFutureLabels;
        const tooltipText = isPast
          ? (isShown ? '👁 過去ラベル表示中（クリックで非表示）' : '👁‍🗨 過去ラベル非表示中（クリックで表示）')
          : (isShown ? '👁 未来ラベル表示中（クリックで非表示）' : '👁‍🗨 未来ラベル非表示中（クリックで表示）');
        const tooltipBg = isLight ? '#1e293b' : '#09090b';
        const tooltipFg = isLight ? '#f8fafc' : '#f4f4f5';

        ctx.save();
        ctx.font = 'bold 11px Inter, sans-serif';
        const tw = ctx.measureText(tooltipText).width;
        const th = 24;
        const pillW = tw + 18;
        const tipX = isPast ? metrics.zone2Center : metrics.zone4Center;
        const tipY = 70;

        ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
        ctx.shadowBlur = 8;
        ctx.shadowOffsetY = 2;

        ctx.fillStyle = tooltipBg;
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(tipX - pillW / 2, tipY - th / 2, pillW, th, 6);
        } else {
          ctx.rect(tipX - pillW / 2, tipY - th / 2, pillW, th);
        }
        ctx.fill();

        ctx.strokeStyle = isLight ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
        ctx.fillStyle = tooltipFg;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(tooltipText, tipX, tipY);
        ctx.restore();
      }

      ctx.restore();

      // Check maximum velocity of nodes to decide if physics simulation can sleep
      let maxVelocity = 0;
      graphNodes.forEach((node) => {
        const v = Math.hypot(node.vx, node.vy);
        if (v > maxVelocity) maxVelocity = v;
        const lv = Math.hypot(node.labelVx || 0, node.labelVy || 0);
        if (lv > maxVelocity) maxVelocity = lv;
      });

      const isInteracting = Boolean(
        draggedGraphNode ||
        isPanningCanvas ||
        isMouseDown ||
        (Date.now() - lastWheelTime < 350)
      );
      if (isInteracting) {
        idleTicks = 0;
        settledFrames = 0;
      } else {
        idleTicks++;
      }

      if (!isInteracting && idleTicks > 40 && maxVelocity < 0.02) {
        settledFrames++;
      } else if (!isInteracting && maxVelocity >= 0.02) {
        settledFrames = 0;
      }

      if (settledFrames > 25) {
        canvasAnimationId = null;
        return;
      }

      canvasAnimationId = requestAnimationFrame(animate);
    }

    animate();
    setupCanvasInteractivity();
  }

  function setupCanvasInteractivity() {
    let clickStartX = 0;
    let clickStartY = 0;
    let dragOffsetX = 0;
    let dragOffsetY = 0;
    let lastClickTime = 0;
    let lastClickNodeId = null;

    function distToSegment(px, py, x1, y1, x2, y2) {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const l2 = dx * dx + dy * dy;
      if (l2 === 0) return Math.hypot(px - x1, py - y1);
      let t = ((px - x1) * dx + (py - y1) * dy) / l2;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
    }

    canvas.onmousedown = (e) => {
      if (canvas.__wakeAnimation) canvas.__wakeAnimation();
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      clickStartX = e.clientX;
      clickStartY = e.clientY;

      const selectedId = doubleClickedSubtreeId || focusedTaskId;
      const activeTreeSet = selectedId ? getDescendantIds(selectedId) : null;
      const isTimelineMode = Boolean(selectedId && activeTreeSet);
      const cssWidth = canvas.width / (window.devicePixelRatio || 1);
      const metrics = getTimelineLayoutMetrics(cssWidth);

      if (isTimelineMode) {
        const isInPastEye = mouseX >= metrics.zone2End - 28 && mouseX <= metrics.zone2End - 6 && mouseY >= 22 && mouseY <= 48;
        const isInFutureEye = mouseX >= metrics.zone4End - 28 && mouseX <= metrics.zone4End - 6 && mouseY >= 22 && mouseY <= 48;
        if (isInPastEye || isInFutureEye) {
          return;
        }
      }

      // Prioritize the hovered/proximity frontmost node if mouse is within interaction range
      let hitNode = null;
      if (hoveredNodeId) {
        const candidate = graphNodes.find((n) => n.task.id === hoveredNodeId);
        if (candidate) {
          const distCenter = Math.hypot(candidate.x - mouseX, candidate.y - mouseY);
          let distLabel = Infinity;
          if (candidate.labelX !== undefined && candidate.labelY !== undefined) {
            distLabel = Math.hypot(candidate.labelX - mouseX, candidate.labelY - mouseY);
          }
          if (Math.min(distCenter, distLabel) <= 65) {
            hitNode = candidate;
          }
        }
      }
      if (!hitNode) {
        hitNode = graphNodes.find((n) => Math.hypot(n.x - mouseX, n.y - mouseY) <= 28);
      }

      if (hitNode) {
        isMouseDown = true;
        draggedGraphNode = hitNode;
        dragOffsetX = mouseX - hitNode.x;
        dragOffsetY = mouseY - hitNode.y;
        hitNode.isPinned = true;
      } else {
        if (selectedId) {
          isPanningCanvas = true;
          panStartX = e.clientX;
          hasPanned = false;
        }
      }
    };

    canvas.onmousemove = (e) => {
      if (canvas.__wakeAnimation) canvas.__wakeAnimation();
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const selectedId = doubleClickedSubtreeId || focusedTaskId;
      const activeTreeSet = selectedId ? getDescendantIds(selectedId) : null;
      const isTimelineMode = Boolean(selectedId && activeTreeSet);
      const activeTimelineSet = isTimelineMode ? new Set(activeTreeSet || []) : null;
      if (isTimelineMode && activeTimelineSet) {
        currentTasks.forEach((t) => {
          if (isIsolatedTask(t) && !t.dueDate) {
            activeTimelineSet.add(t.id);
          }
        });
      }
      const cssWidth = canvas.width / (window.devicePixelRatio || 1);
      const metrics = getTimelineLayoutMetrics(cssWidth);

      if (isTimelineMode && !isMouseDown) {
        const isInPastEye = mouseX >= metrics.zone2End - 28 && mouseX <= metrics.zone2End - 6 && mouseY >= 22 && mouseY <= 48;
        const isInFutureEye = mouseX >= metrics.zone4End - 28 && mouseX <= metrics.zone4End - 6 && mouseY >= 22 && mouseY <= 48;
        if (isInPastEye) {
          if (hoveredEyeZone !== 'past') {
            hoveredEyeZone = 'past';
            renderCurrentView();
          }
          hoveredNodeId = null;
          canvas.style.cursor = 'pointer';
          return;
        } else if (isInFutureEye) {
          if (hoveredEyeZone !== 'future') {
            hoveredEyeZone = 'future';
            renderCurrentView();
          }
          hoveredNodeId = null;
          canvas.style.cursor = 'pointer';
          return;
        } else if (hoveredEyeZone !== null) {
          hoveredEyeZone = null;
          renderCurrentView();
        }
      }

      if (isMouseDown && draggedGraphNode) {
        if (canvas.__wakeAnimation) canvas.__wakeAnimation();
        draggedGraphNode.x = mouseX - dragOffsetX;
        draggedGraphNode.y = mouseY - dragOffsetY;
      } else if (isPanningCanvas) {
        if (canvas.__wakeAnimation) canvas.__wakeAnimation();
        const deltaX = e.clientX - panStartX;
        if (Math.abs(e.clientX - clickStartX) > 4) {
          hasPanned = true;
        }
        canvasPanOffsetX += deltaX;
        panStartX = e.clientX;
      } else {
        // Find closest node considering node circle center, label plate, and leader line segment
        let closestNode = null;
        let minEffectiveDist = Infinity;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        for (const n of graphNodes) {
          const distCenter = Math.hypot(n.x - mouseX, n.y - mouseY);
          let distLabel = Infinity;
          let nodeLabelVisible = true;
          if (isTimelineMode && activeTimelineSet && activeTimelineSet.has(n.task.id)) {
            if (n.task.dueDate) {
              const d = new Date(n.task.dueDate);
              d.setHours(0, 0, 0, 0);
              const diffDays = Math.round((d.getTime() - today.getTime()) / 86400000);
              const colX = metrics.timelineStartX + canvasPanOffsetX + (diffDays + 0.5) * metrics.dayWidth;
              if (colX < metrics.timelineStartX && !showPastLabels) {
                nodeLabelVisible = false;
              } else if (colX > metrics.timelineEndX && !showFutureLabels) {
                nodeLabelVisible = false;
              }
            }
          }
          if (nodeLabelVisible && n.labelX !== undefined && n.labelY !== undefined) {
            distLabel = Math.hypot(n.labelX - mouseX, n.labelY - mouseY);
          }
          let effectiveDist = Math.min(distCenter, distLabel);

          // Proximity detection along leader line in timeline mode
          if (isTimelineMode && n.labelX !== undefined && n.labelY !== undefined) {
            const childCount = currentTasks.filter((t) => t.parentId === n.task.id).length;
            const coreRadius = 9 + Math.min(childCount * 4, 16);
            const lineX = (n.labelX !== undefined) ? n.labelX : n.x;
            const lineDist = distToSegment(mouseX, mouseY, lineX, n.y - coreRadius, lineX, n.labelY + 12);
            if (lineDist < 12) {
              effectiveDist = Math.min(effectiveDist, lineDist);
            }
          }

          if (effectiveDist < minEffectiveDist) {
            minEffectiveDist = effectiveDist;
            closestNode = n;
          }
        }

        // Within 65px radius of node center, label plate, or along leader line: prioritize as hovered/frontmost
        const newHoveredId = (closestNode && minEffectiveDist <= 65) ? closestNode.task.id : null;
        if (newHoveredId !== hoveredNodeId) {
          hoveredNodeId = newHoveredId;
          canvas.style.cursor = hoveredNodeId ? 'pointer' : 'default';
          if (canvas.__wakeAnimation) canvas.__wakeAnimation();
        }
      }
    };

    canvas.onmouseleave = () => {
      isMouseDown = false;
      draggedGraphNode = null;
      if (hoveredNodeId !== null) {
        hoveredNodeId = null;
        if (canvas.__wakeAnimation) canvas.__wakeAnimation();
      }
      if (hoveredEyeZone !== null) {
        hoveredEyeZone = null;
        renderCurrentView();
      }
      canvas.style.cursor = 'default';
    };

    canvas.onmouseup = (e) => {
      if (canvas.__wakeAnimation) canvas.__wakeAnimation();
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const dist = Math.hypot(e.clientX - clickStartX, e.clientY - clickStartY);
      const now = Date.now();

      if (isPanningCanvas) {
        isPanningCanvas = false;
        if (hasPanned) {
          return;
        }
      }

      // Check click on eye toggle buttons in timeline mode
      const selectedId = doubleClickedSubtreeId || focusedTaskId;
      const activeTreeSet = selectedId ? getDescendantIds(selectedId) : null;
      const isTimelineMode = Boolean(selectedId && activeTreeSet);
      const cssWidth = canvas.width / (window.devicePixelRatio || 1);
      const metrics = getTimelineLayoutMetrics(cssWidth);

      if (dist < 6 && isTimelineMode) {
        const isInPastEye = mouseX >= metrics.zone2End - 28 && mouseX <= metrics.zone2End - 6 && mouseY >= 22 && mouseY <= 48;
        const isInFutureEye = mouseX >= metrics.zone4End - 28 && mouseX <= metrics.zone4End - 6 && mouseY >= 22 && mouseY <= 48;
        if (isInPastEye) {
          togglePastLabels();
          return;
        }
        if (isInFutureEye) {
          toggleFutureLabels();
          return;
        }
      }

      // Check click on "↺ 今日へ戻る" button in timeline mode
      if (selectedId && Math.abs(canvasPanOffsetX) > 20) {
        if (mouseX >= metrics.timelineStartX + 10 && mouseX <= metrics.timelineStartX + 95 && mouseY >= 60 && mouseY <= 82) {
          canvasPanOffsetX = 0;
          renderCurrentView();
          return;
        }
      }

      if (draggedGraphNode) {
        draggedGraphNode.isPinned = false;

        // Check in-canvas top strip drop for elevating to root
        const droppedOnTopStrip = draggedGraphNode.y <= 65;

        if (droppedOnTopStrip && draggedGraphNode.task.parentId) {
          changeTaskParent(draggedGraphNode.task.id, null);
        } else if (dist < 5) {
          // Click Node: Check double click
          const task = draggedGraphNode.task;

          if (lastClickNodeId === task.id && now - lastClickTime < 350) {
            // DOUBLE CLICK: Subtree Focus Mode! 即座にその要素を中心としたタイムラインを展開
            doubleClickedSubtreeId = task.id;
            focusedTaskId = task.id;
            inspectorSelectedTaskId = task.id;
            lastClickTime = 0;
            lastClickNodeId = null;
            canvasPanOffsetX = 0;
            openObsidianNodeInspector(task);
            renderCurrentView();
            return;
          }

          lastClickTime = now;
          lastClickNodeId = task.id;

          const currentTimelineRoot = doubleClickedSubtreeId || focusedTaskId;

          if (!currentTimelineRoot) {
            // ① 全表示からクリックされた要素: その要素を中心とした日付表示を開始
            focusedTaskId = task.id;
            inspectorSelectedTaskId = task.id;
            canvasPanOffsetX = 0;
          } else {
            // ② すでに日付表示中の場合:
            if (inspectorSelectedTaskId === task.id) {
              // ★すでに選択されている要素をもう一度クリックされた場合:
              // その要素を中心とした日付表示へ昇格・切り替え！
              if (currentTimelineRoot !== task.id) {
                focusedTaskId = task.id;
                doubleClickedSubtreeId = null;
                canvasPanOffsetX = 0;
              }
            } else {
              // ★小要素をクリックした時:
              // タイムラインの親（focusedTaskId）は変えず、小要素の進行状況編集（インスペクター選択）で止まる！
              inspectorSelectedTaskId = task.id;
            }
          }

          openObsidianNodeInspector(task);
          renderCurrentView();
        } else if (!droppedOnTopStrip) {
          if (isTimelineMode) {
            // In timeline mode: DRAG AND DROP UPDATES THE DUE DATE!
            // Node combination / parenting is strictly disabled to prevent accidental tree restructuring.
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            if (draggedGraphNode.x < metrics.zone2Start) {
              // Dropped in Zone 1: Clear Due Date
              if (draggedGraphNode.task.dueDate !== null) {
                promptDateChangeConfirmation(draggedGraphNode.task, null);
              }
            } else {
              // Calculate target date based on drop X
              const diffDays = Math.round((draggedGraphNode.x - (metrics.timelineStartX + canvasPanOffsetX)) / metrics.dayWidth);
              const targetDate = new Date(today.getTime() + diffDays * 86400000);
              targetDate.setHours(23, 59, 59, 999);
              const newDueTs = targetDate.getTime();
              if (draggedGraphNode.task.dueDate !== newDueTs) {
                const m = targetDate.getMonth() + 1;
                const d = targetDate.getDate();
                const dayStr = ['日', '月', '火', '水', '木', '金', '土'][targetDate.getDay()];
                promptDateChangeConfirmation(draggedGraphNode.task, newDueTs, `${m}/${d}(${dayStr})`);
              }
            }
          } else {
            // Normal graph mode: Check drop target on another node
            const targetNode = graphNodes.find(
              (n) => n.task.id !== draggedGraphNode.task.id && Math.hypot(n.x - draggedGraphNode.x, n.y - draggedGraphNode.y) <= 45
            );

            if (targetNode) {
              // Never combine with dimmed background nodes
              if (activeTreeSet && !activeTreeSet.has(targetNode.task.id)) {
                // Dimmed background node: ignore drop
              } else if (isDescendantOf(targetNode.task.id, draggedGraphNode.task.id)) {
                showErrorToast('親タスクを自己の子孫タスクの中に移動することはできません。');
              } else {
                promptParentingConfirmation(draggedGraphNode.task, targetNode.task);
              }
            }
          }
        }
      } else if (dist < 5) {
        // Click on empty canvas background: deselect focus and close inspector
        closeObsidianNodeInspector();
        focusedTaskId = null;
        doubleClickedSubtreeId = null;
        canvasPanOffsetX = 0;
        updateFilterControlsState();
        renderCurrentView();
      }
      isMouseDown = false;
      draggedGraphNode = null;
    };

    canvas.onwheel = (e) => {
      const selectedId = doubleClickedSubtreeId || focusedTaskId;
      if (selectedId) {
        e.preventDefault();
        let delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        if (e.deltaMode === 1) {
          delta *= 24;
        } else if (e.deltaMode === 2) {
          delta *= 400;
        }
        canvasPanOffsetX -= delta * 0.7;
        lastWheelTime = Date.now();
        layoutDirty = true;
        if (canvas.__wakeAnimation) {
          canvas.__wakeAnimation();
        }
      }
    };
  }

  // Obsidian Node Inspector Open & Logic
  function openObsidianNodeInspector(task) {
    if (!obsidianInspector) return;

    inspectorSelectedTaskId = task.id;

    if (inspectorBreadcrumb) {
      inspectorBreadcrumb.innerHTML = '';
      const breadcrumbLabel = document.createElement('span');
      breadcrumbLabel.className = 'breadcrumb-label';
      breadcrumbLabel.textContent = '階層:';
      inspectorBreadcrumb.appendChild(breadcrumbLabel);

      const ancestors = [];
      let cur = task;
      const visited = new Set();
      while (cur && cur.parentId && !visited.has(cur.parentId)) {
        visited.add(cur.id);
        const parent = currentTasks.find((t) => t.id === cur.parentId);
        if (parent) {
          ancestors.unshift(parent);
          cur = parent;
        } else {
          break;
        }
      }

      if (ancestors.length === 0) {
        const rootItem = document.createElement('span');
        rootItem.className = 'breadcrumb-current';
        rootItem.textContent = 'ルート (親なし)';
        inspectorBreadcrumb.appendChild(rootItem);
      } else {
        ancestors.forEach((anc) => {
          const ancSpan = document.createElement('span');
          ancSpan.className = 'breadcrumb-item clickable';
          ancSpan.textContent = anc.title;
          ancSpan.title = `親タスク「${anc.title}」へ移動`;
          ancSpan.onclick = (e) => {
            e.stopPropagation();
            focusedTaskId = anc.id;
            inspectorSelectedTaskId = anc.id;
            doubleClickedSubtreeId = null;
            canvasPanOffsetX = 0;
            openObsidianNodeInspector(anc);
            renderCurrentView();
          };
          inspectorBreadcrumb.appendChild(ancSpan);

          const sep = document.createElement('span');
          sep.className = 'breadcrumb-separator';
          sep.textContent = '>';
          inspectorBreadcrumb.appendChild(sep);
        });

        const curItem = document.createElement('span');
        curItem.className = 'breadcrumb-current';
        curItem.textContent = task.title;
        inspectorBreadcrumb.appendChild(curItem);
      }
    }

    if (inspectorStatusBadge) {
      const statusLabels = { TODO: '未着手', IN_PROGRESS: '進行中', DONE: '完了' };
      inspectorStatusBadge.textContent = statusLabels[task.status] || task.status;
      inspectorStatusBadge.dataset.status = task.status;
    }

    if (inspectorTitleInput) {
      inspectorTitleInput.value = task.title;
    }

    if (inspectorDueDateInput) {
      if (task.dueDate) {
        const d = new Date(task.dueDate);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        inspectorDueDateInput.value = `${yyyy}-${mm}-${dd}`;
      } else {
        inspectorDueDateInput.value = '';
      }
    }

    const statusBtns = obsidianInspector.querySelectorAll('.btn-status-toggle');
    statusBtns.forEach((btn) => {
      const btnStatus = btn.dataset.status;
      btn.classList.toggle('active', btnStatus === task.status);
      btn.onclick = (e) => {
        e.stopPropagation();
        const latestTask = currentTasks.find((t) => t.id === inspectorSelectedTaskId);
        if (latestTask && latestTask.status !== btnStatus) {
          updateTaskStatus(latestTask.id, btnStatus);
        }
      };
    });

    if (btnInspectorElevate) {
      btnInspectorElevate.disabled = !task.parentId;
      btnInspectorElevate.style.opacity = task.parentId ? '1' : '0.4';
      btnInspectorElevate.onclick = (e) => {
        e.stopPropagation();
        const latestTask = currentTasks.find((t) => t.id === inspectorSelectedTaskId);
        if (latestTask && latestTask.parentId) {
          changeTaskParent(latestTask.id, null);
        }
      };
    }

    if (btnInspectorDelete) {
      btnInspectorDelete.onclick = (e) => {
        e.stopPropagation();
        const latestTask = currentTasks.find((t) => t.id === inspectorSelectedTaskId);
        if (latestTask) {
          deleteTask(latestTask.id);
        }
      };
    }

    obsidianInspector.classList.remove('hidden');
  }

  function closeObsidianNodeInspector() {
    if (obsidianInspector) {
      obsidianInspector.classList.add('hidden');
    }
    inspectorSelectedTaskId = null;
    focusedTaskId = null;
    doubleClickedSubtreeId = null;
    canvasPanOffsetX = 0;
    updateFilterControlsState();
  }

  if (btnInspectorClose) {
    btnInspectorClose.addEventListener('click', closeObsidianNodeInspector);
  }

  if (inspectorTitleInput) {
    inspectorTitleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const newTitle = inspectorTitleInput.value.trim();
        if (newTitle && inspectorSelectedTaskId) {
          updateTaskTitle(inspectorSelectedTaskId, newTitle);
          inspectorTitleInput.blur();
        }
      }
    });

    inspectorTitleInput.addEventListener('blur', () => {
      const newTitle = inspectorTitleInput.value.trim();
      const currentTask = currentTasks.find((t) => t.id === inspectorSelectedTaskId);
      if (newTitle && currentTask && newTitle !== currentTask.title) {
        updateTaskTitle(inspectorSelectedTaskId, newTitle);
      }
    });
  }

  if (inspectorDueDateInput) {
    inspectorDueDateInput.addEventListener('change', () => {
      if (!inspectorSelectedTaskId) return;
      const task = currentTasks.find((t) => t.id === inspectorSelectedTaskId);
      if (!task) return;
      const val = inspectorDueDateInput.value;
      const dueDateTs = val ? new Date(val + 'T23:59:59').getTime() : null;
      if (dueDateTs === task.dueDate) return;

      let dateStr = '';
      if (dueDateTs) {
        const dObj = new Date(dueDateTs);
        const m = dObj.getMonth() + 1;
        const d = dObj.getDate();
        const dayStr = ['日', '月', '火', '水', '木', '金', '土'][dObj.getDay()];
        dateStr = `${m}/${d}(${dayStr})`;
      }

      promptDateChangeConfirmation(task, dueDateTs, dateStr, () => {
        if (task.dueDate) {
          const dObj = new Date(task.dueDate);
          const yyyy = dObj.getFullYear();
          const mm = String(dObj.getMonth() + 1).padStart(2, '0');
          const dd = String(dObj.getDate()).padStart(2, '0');
          inspectorDueDateInput.value = `${yyyy}-${mm}-${dd}`;
        } else {
          inspectorDueDateInput.value = '';
        }
      });
    });
  }

  function updateInspectorViewIfNeeded() {
    if (inspectorSelectedTaskId && obsidianInspector && !obsidianInspector.classList.contains('hidden')) {
      const updated = currentTasks.find((t) => t.id === inspectorSelectedTaskId);
      if (updated) {
        const statusLabels = { TODO: '未着手', IN_PROGRESS: '進行中', DONE: '完了' };
        if (inspectorStatusBadge) {
          inspectorStatusBadge.textContent = statusLabels[updated.status] || updated.status;
          inspectorStatusBadge.dataset.status = updated.status;
        }
        if (btnInspectorElevate) {
          btnInspectorElevate.disabled = !updated.parentId;
          btnInspectorElevate.style.opacity = updated.parentId ? '1' : '0.4';
        }
        const statusBtns = obsidianInspector.querySelectorAll('.btn-status-toggle');
        statusBtns.forEach((btn) => {
          btn.classList.toggle('active', btn.dataset.status === updated.status);
        });
      } else {
        closeObsidianNodeInspector();
      }
    }
  }

  // --------------------------------------------------------------------------
  // Common Helpers & Component Builders
  // --------------------------------------------------------------------------
  function isDescendantOf(candidateParentId, taskId) {
    if (!candidateParentId || !taskId) return false;
    if (candidateParentId === taskId) return true;

    let currentId = candidateParentId;
    const visited = new Set();
    while (currentId) {
      if (currentId === taskId) return true;
      if (visited.has(currentId)) break;
      visited.add(currentId);
      const parentTask = currentTasks.find((t) => t.id === currentId);
      currentId = parentTask ? parentTask.parentId : null;
    }
    return false;
  }

  let pendingActionCallback = null;
  let pendingCancelCallback = null;

  function promptActionConfirmation({ title = '確認', message = '', onConfirm = () => {}, onCancel = () => {} }) {
    if (confirmModalTitle) confirmModalTitle.textContent = title;
    confirmModalText.textContent = message;
    pendingActionCallback = onConfirm;
    pendingCancelCallback = onCancel;
    confirmModal.classList.remove('hidden');
  }

  function promptParentingConfirmation(childTask, parentTask) {
    promptActionConfirmation({
      title: '親タスク設定の確認',
      message: `タスク「${childTask.title}」を「${parentTask.title}」の子タスクに変更しますか？ (Enterキーで実行)`,
      onConfirm: () => changeTaskParent(childTask.id, parentTask.id),
    });
  }

  function promptDateChangeConfirmation(task, newDueTs, dateStr = '', onCancel = null) {
    const isClearing = newDueTs === null;
    const message = isClearing
      ? `タスク「${task.title}」の完了予定日を「未設定」に変更しますか？ (Enterキーで実行)`
      : `タスク「${task.title}」の完了予定日を「${dateStr}」に変更しますか？ (Enterキーで実行)`;

    promptActionConfirmation({
      title: '完了予定日変更の確認',
      message,
      onConfirm: () => {
        updateTaskDueDate(task.id, newDueTs);
        if (isClearing) {
          showNotificationToast(`「${task.title}」の期日を未設定にしました`, 'info');
        } else {
          showNotificationToast(`「${task.title}」の完了予定日を ${dateStr} に設定しました`, 'success');
        }
      },
      onCancel: () => {
        if (onCancel) onCancel();
      },
    });
  }


  if (btnModalCancel) {
    btnModalCancel.onclick = () => {
      confirmModal.classList.add('hidden');
      if (pendingCancelCallback) {
        pendingCancelCallback();
      }
      pendingActionCallback = null;
      pendingCancelCallback = null;
    };
  }

  if (btnModalConfirm) {
    btnModalConfirm.onclick = () => {
      if (pendingActionCallback) {
        pendingActionCallback();
      }
      confirmModal.classList.add('hidden');
      pendingActionCallback = null;
      pendingCancelCallback = null;
    };
  }

  function setupKeyboardNavigation() {
    window.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
        return;
      }

      if (confirmModal && !confirmModal.classList.contains('hidden')) {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (btnModalConfirm) btnModalConfirm.click();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          if (btnModalCancel) btnModalCancel.click();
        }
        return;
      }

      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape'].includes(e.key)) {
        return;
      }

      if (currentTasks.length === 0) return;

      if (currentViewMode === 'OBSIDIAN_GRAPH_VIEW') {
        if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
        e.preventDefault();
        const currentIdx = currentTasks.findIndex((t) => t.id === focusedTaskId);
        let nextIdx = 0;

        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
          nextIdx = currentIdx >= 0 && currentIdx < currentTasks.length - 1 ? currentIdx + 1 : 0;
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
          nextIdx = currentIdx > 0 ? currentIdx - 1 : currentTasks.length - 1;
        }

        focusedTaskId = currentTasks[nextIdx].id;
        renderCurrentView();
        return;
      }
    });
  }

  if (btnUndo) {
    btnUndo.addEventListener('click', () => {
      undoLastAction();
    });
  }

  function undoLastAction() {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          action: 'UNDO_LAST_ACTION',
        })
      );
    }
  }

  // Socket Emitters
  function updateTaskStatus(taskId, newStatus) {
    const task = currentTasks.find((t) => t.id === taskId);
    if (newStatus === 'IN_PROGRESS' && (!task || !task.dueDate)) {
      promptInProgressDueDate(taskId);
      return;
    }

    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          action: 'UPDATE_STATUS',
          taskId,
          status: newStatus,
        })
      );
    }
  }

  function promptInProgressDueDate(taskId) {
    if (!inProgressDueModal || !inProgressDateInput) return;

    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    inProgressDateInput.value = `${yyyy}-${mm}-${dd}`;

    inProgressDueModal.classList.remove('hidden');

    btnInProgressCancel.onclick = () => {
      inProgressDueModal.classList.add('hidden');
    };

    btnInProgressConfirm.onclick = () => {
      const val = inProgressDateInput.value;
      if (!val) {
        showErrorToast('完了予定日を選択してください');
        return;
      }
      const dueDateTs = new Date(val + 'T23:59:59').getTime();
      inProgressDueModal.classList.add('hidden');

      updateTaskDueDate(taskId, dueDateTs);
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({
            action: 'UPDATE_STATUS',
            taskId,
            status: 'IN_PROGRESS',
          })
        );
      }
    };
  }

  function updateTaskTitle(taskId, newTitle) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          action: 'UPDATE_TITLE',
          taskId,
          title: newTitle,
        })
      );
    }
  }

  function updateTaskDueDate(taskId, dueDate) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          action: 'UPDATE_DUE_DATE',
          taskId,
          dueDate,
        })
      );
    }
  }

  function changeTaskParent(taskId, newParentId) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          action: 'CHANGE_PARENT',
          taskId,
          newParentId,
        })
      );
    }
  }

  function deleteTask(taskId) {
    const task = currentTasks.find((t) => t.id === taskId);
    if (!task) return;

    const childCount = currentTasks.filter((t) => t.parentId === taskId).length;

    if (childCount >= 3) {
      promptDeleteReason(task);
      return;
    }

    promptActionConfirmation({
      title: 'タスク削除の確認',
      message: `タスク「${task.title}」を削除しますか？ (Enterキーで実行)`,
      onConfirm: () => {
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(
            JSON.stringify({
              action: 'DELETE_TASK',
              taskId,
            })
          );
        }
        closeObsidianNodeInspector();
        showNotificationToast(`タスク「${task.title}」を削除しました`, 'info');
      },
    });
  }

  function promptDeleteReason(task) {
    if (!deleteReasonModal || !deleteReasonInput) return;

    deleteReasonInput.value = '';
    deleteReasonCount.textContent = '0';
    btnDeleteReasonConfirm.disabled = true;

    deleteReasonModal.classList.remove('hidden');

    const updateCount = () => {
      const len = deleteReasonInput.value.trim().length;
      deleteReasonCount.textContent = `${len}`;
      btnDeleteReasonConfirm.disabled = len < 10;
    };

    deleteReasonInput.oninput = updateCount;

    btnDeleteReasonCancel.onclick = () => {
      deleteReasonModal.classList.add('hidden');
    };

    btnDeleteReasonConfirm.onclick = () => {
      const reason = deleteReasonInput.value.trim();
      if (reason.length < 10) return;

      deleteReasonModal.classList.add('hidden');
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({
            action: 'DELETE_TASK',
            taskId: task.id,
            reason,
          })
        );
      }
      closeObsidianNodeInspector();
    };
  }

  function sendCreateTask(title, parentId = null) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          action: 'CREATE_TASK',
          title,
          parentId,
        })
      );
    }
  }

  quickForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = quickInputTitle.value.trim();
    const selectedVal = selectQuickParent.value;

    if (!title) return;

    sendCreateTask(title, selectedVal || null);

    quickInputTitle.value = '';
  });

  // Expose test/debug helper for Playwright layout verification
  window.__wbserDebug = {
    getGraphNodes: () => graphNodes.map((n) => ({
      id: n.task.id,
      title: n.task.title,
      parentId: n.task.parentId,
      dueDate: n.task.dueDate,
      status: n.task.status,
      x: Math.round(n.x * 10) / 10,
      y: Math.round(n.y * 10) / 10,
      vx: Math.round(n.vx * 100) / 100,
      vy: Math.round(n.vy * 100) / 100,
      labelX: n.labelX ? Math.round(n.labelX * 10) / 10 : Math.round(n.x * 10) / 10,
      labelY: n.labelY ? Math.round(n.labelY * 10) / 10 : Math.round(n.y * 10) / 10
    })),
    getSelectedTaskId: () => doubleClickedSubtreeId || focusedTaskId || inspectorSelectedTaskId,
    getZoneVisibility: () => ({ showPastLabels, showFutureLabels, hoveredEyeZone }),
    getTimelineSlots: () => Array.from(timelineSlotMap.entries()).map(([taskId, info]) => ({ taskId, ...info })),
    togglePastLabels,
    toggleFutureLabels,
    getCanvasMetrics: () => {
      const rect = canvas ? canvas.getBoundingClientRect() : { width: 0, height: 0, top: 0, bottom: 0, left: 0, right: 0 };
      const inspectorRect = obsidianInspector && !obsidianInspector.classList.contains('hidden')
        ? obsidianInspector.getBoundingClientRect()
        : null;
      const inputRect = quickForm ? quickForm.getBoundingClientRect() : null;
      const cssWidth = canvas ? canvas.width / (window.devicePixelRatio || 1) : 0;
      const cssHeight = canvas ? canvas.height / (window.devicePixelRatio || 1) : 0;
      const tMetrics = getTimelineLayoutMetrics(cssWidth);
      return {
        width: cssWidth,
        height: cssHeight,
        rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
        effectiveTop: 42,
        effectiveBottom: inspectorRect ? inspectorRect.top : (inputRect ? inputRect.top : window.innerHeight),
        ...tMetrics,
        canvasPanOffsetX,
      };
    },
    clickNode: (taskId) => {
      const node = graphNodes.find((n) => n.task.id === taskId);
      if (node) {
        if (!focusedTaskId && !doubleClickedSubtreeId) {
          focusedTaskId = node.task.id;
        } else if (inspectorSelectedTaskId === node.task.id) {
          focusedTaskId = node.task.id;
          doubleClickedSubtreeId = null;
        }
        inspectorSelectedTaskId = node.task.id;
        openObsidianNodeInspector(node.task);
        renderCurrentView();
        return true;
      }
      return false;
    },
    hoverNode: (taskId) => {
      hoveredNodeId = taskId;
      renderCurrentView();
      return true;
    },
    clearSelection: () => {
      closeObsidianNodeInspector();
      return true;
    }
  };

  initTheme();
  setupKeyboardNavigation();
  initWebSocket();
})();
