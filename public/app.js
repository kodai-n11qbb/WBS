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

  // Dynamic Y Ratio calculation automatically adjusting to the max visible nest depth & inspector panel
  function computeDynamicYRatio(depth, maxTreeDepth, isSelectedTree = false, isInspectorOpen = false) {
    const topY = 0.18;
    const bottomY = isInspectorOpen ? 0.65 : (isSelectedTree ? 0.82 : 0.85);

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

    const padX = Math.min(100, width * 0.1);
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

    // Ensure minimum horizontal spacing (135px) between tasks at the same depth to prevent label overlap
    const tasksByDepth = new Map();
    visibleTasks.forEach((t) => {
      const d = getTaskDepth(t);
      if (!tasksByDepth.has(d)) tasksByDepth.set(d, []);
      tasksByDepth.get(d).push(t);
    });

    tasksByDepth.forEach((tasksAtDepth) => {
      if (tasksAtDepth.length <= 1) return;
      tasksAtDepth.sort((a, b) => (xPosMap.get(a.id) || 0) - (xPosMap.get(b.id) || 0));
      for (let i = 1; i < tasksAtDepth.length; i++) {
        const prevTask = tasksAtDepth[i - 1];
        const curTask = tasksAtDepth[i];
        const prevX = xPosMap.get(prevTask.id) || 0;
        const curX = xPosMap.get(curTask.id) || 0;
        const prevW = (prevTask.title || '').length * 11 + 36;
        const curW = (curTask.title || '').length * 11 + 36;
        const minSpacing = Math.max(145, (prevW + curW) / 2 + 30);
        if (curX - prevX < minSpacing) {
          xPosMap.set(curTask.id, prevX + minSpacing);
        }
      }
    });

    return xPosMap;
  }


  // Canvas Animation Frame & Physics State
  let canvasAnimationId = null;
  let graphNodes = [];
  let draggedGraphNode = null;

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
    const selectedId = doubleClickedSubtreeId || focusedTaskId || inspectorSelectedTaskId;
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
    ctx.fillText('◀ 過去', metrics.zone2Center, 35);


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
    ctx.font = 'bold 10.5px Inter, sans-serif';
    ctx.fillText('未来 ▶ (期間外)', metrics.zone4Center, 35);
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

    const selectedId = doubleClickedSubtreeId || focusedTaskId || inspectorSelectedTaskId;
    let visibleTasks = currentTasks;

    if (selectedId) {
      const activeSubtreeSet = getDescendantIds(selectedId);
      if (activeSubtreeSet) {
        visibleTasks = visibleTasks.filter((t) => activeSubtreeSet.has(t.id));
      }
      if (currentMaxDepth !== 'all') {
        const maxRelDepth = typeof currentMaxDepth === 'number' ? currentMaxDepth : parseInt(currentMaxDepth, 10);
        visibleTasks = visibleTasks.filter((t) => {
          const rDepth = getRelativeDepth(t, selectedId);
          return rDepth !== null && rDepth <= maxRelDepth;
        });
      }
    } else {
      if (currentMaxDepth !== 'all') {
        const maxDepth = typeof currentMaxDepth === 'number' ? currentMaxDepth : parseInt(currentMaxDepth, 10);
        visibleTasks = visibleTasks.filter((t) => getTaskDepth(t) < maxDepth);
      }
    }

    const maxVisibleDepth = visibleTasks.reduce((max, t) => Math.max(max, getTaskDepth(t)), 0);
    const existingNodeMap = new Map(graphNodes.map((n) => [n.task.id, n]));
    const activeInitialSelectedId = doubleClickedSubtreeId || focusedTaskId || inspectorSelectedTaskId;
    const sugiyamaXMap = computeSugiyamaTreeXPositions(visibleTasks, width, activeInitialSelectedId);

    graphNodes = visibleTasks.map((task, idx) => {
      const existing = existingNodeMap.get(task.id);
      if (existing) {
        existing.task = task;
        return existing;
      }

      const depth = getTaskDepth(task);
      const initX = sugiyamaXMap.get(task.id) || width / 2;
      const initY = height * computeDynamicYRatio(depth, maxVisibleDepth, false);

      return {
        task,
        x: initX,
        y: initY,
        vx: 0,
        vy: 0,
        isPinned: false,
      };
    });

    const nodeMap = new Map(graphNodes.map((n) => [n.task.id, n]));

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

      const isInspectorOpen = obsidianInspector && !obsidianInspector.classList.contains('hidden');
      const selectedId = doubleClickedSubtreeId || focusedTaskId || inspectorSelectedTaskId;
      const activeTreeSet = selectedId ? getDescendantIds(selectedId) : null;
      const isTimelineMode = Boolean(selectedId && activeTreeSet);
      const maxVisibleDepth = visibleTasks.reduce((max, t) => Math.max(max, getTaskDepth(t)), 0);

      // If Timeline Mode (Element Clicked): Render top Date Axis
      if (isTimelineMode) {
        drawCanvasDateAxis(ctx, width, height, isLight);
      }

      // Sugiyama Layered Layout Alignment Force & Timeline Date-Axis Mapping
      const sugiyamaXMap = computeSugiyamaTreeXPositions(visibleTasks, width, selectedId);

      const metrics = getTimelineLayoutMetrics(width);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const dateGroups = new Map();
      let unscheduledList = [];
      let pastList = [];
      let futureList = [];

      if (isTimelineMode) {
        visibleTasks.forEach((t) => {
          if (activeTreeSet.has(t.id)) {
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

        // Consistent sorting by relative depth, then orderIndex
        const sortTaskIds = (ids) => {
          ids.sort((a, b) => {
            const taskA = currentTasks.find((t) => t.id === a);
            const taskB = currentTasks.find((t) => t.id === b);
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
      }

      graphNodes.forEach((node) => {
        if (!node.isPinned) {
          if (isTimelineMode && activeTreeSet.has(node.task.id)) {
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
              const springK = isSubtreeNode ? 0.055 : 0.035;
              node.vx += (targetX - node.x) * springK;
            }
          }
        }
      });

      const minRepelDist = 120;
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
            const force = ((minRepelDist - dist) / minRepelDist) * 0.6;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;

            nodeA.vx -= fx;
            nodeA.vy -= fy;
            nodeB.vx += fx;
            nodeB.vy += fy;
          }

          // 2. Strict vertical clearance for nodes in the same date column
          if (isTimelineMode && activeTreeSet && activeTreeSet.has(nodeA.task.id) && activeTreeSet.has(nodeB.task.id)) {
            if (Math.abs(dx) < 24) {
              const minDistY = 66;
              const curDistY = Math.abs(dy);
              if (curDistY < minDistY) {
                const pushY = ((minDistY - curDistY) / minDistY) * 1.5;
                const sign = dy >= 0 ? 1 : -1;
                nodeA.vy -= sign * pushY;
                nodeB.vy += sign * pushY;
              }
            }
          }

          // 3. Sibling & Text Label Overlap Prevention
          ctx.font = `11px Inter, sans-serif`;
          const textWA = ctx.measureText(nodeA.task.title).width;
          const textWB = ctx.measureText(nodeB.task.title).width;

          const reqLabelWidth = (textWA + textWB) / 2 + 28;
          const reqLabelHeight = 52;

          const absDx = Math.abs(dx);
          const absDy = Math.abs(dy);

          if (absDx < reqLabelWidth && absDy < reqLabelHeight) {
            const overlapX = (reqLabelWidth - absDx) / reqLabelWidth;
            const overlapY = (reqLabelHeight - absDy) / reqLabelHeight;
            const repelStrength = Math.min(overlapX, overlapY) * 0.75;

            const signX = dx >= 0 ? 1 : -1;
            const signY = dy >= 0 ? 1 : -1;

            if (!isTimelineMode) {
              nodeA.vx -= signX * overlapX * repelStrength;
              nodeB.vx += signX * overlapX * repelStrength;
            }
            nodeA.vy -= signY * overlapY * repelStrength;
            nodeB.vy += signY * overlapY * repelStrength;
          }
        }
      }

      let maxSubtreeRelDepth = 0;
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

          if (isTimelineMode && activeTreeSet.has(node.task.id)) {
            const relDepth = getRelativeDepth(node.task, selectedId) ?? 0;
            if (node.task.dueDate) {
              const dObj = new Date(node.task.dueDate);
              dObj.setHours(0, 0, 0, 0);
              const diffDays = Math.round((dObj.getTime() - today.getTime()) / 86400000);
              const colX = metrics.timelineStartX + canvasPanOffsetX + (diffDays + 0.5) * metrics.dayWidth;
              if (colX < metrics.timelineStartX) {
                const pIdx = Math.max(0, pastList.indexOf(node.task.id));
                targetY = 110 + pIdx * 54;
              } else if (colX > metrics.timelineEndX) {
                const fIdx = Math.max(0, futureList.indexOf(node.task.id));
                targetY = 110 + fIdx * 54;
              } else {
                const list = dateGroups.get(dObj.getTime()) || [node.task.id];
                const totalInDate = list.length;
                const maxRel = Math.max(1, maxSubtreeRelDepth);
                const availH = (isInspectorOpen ? (height - 180) : (height - 85)) - 110;
                const stepY = Math.min(95, Math.max(68, availH / Math.max(maxRel, totalInDate - 1)));

                if (totalInDate === 1) {
                  targetY = 110 + relDepth * stepY;
                } else {
                  // Sibling vertical offset for same-depth tasks on same date to ensure zero overlap
                  const sameDepthTasks = list.filter((id) => {
                    const t = currentTasks.find((x) => x.id === id);
                    return (t ? (getRelativeDepth(t, selectedId) ?? 0) : 0) === relDepth;
                  });
                  const siblingOffsetIdx = sameDepthTasks.indexOf(node.task.id);
                  targetY = 110 + relDepth * stepY + siblingOffsetIdx * 68;
                }
              }
            } else {
              const uIdx = Math.max(0, unscheduledList.indexOf(node.task.id));
              targetY = 110 + uIdx * 54;
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
            targetY = height * targetYRatio;
            const hierarchicalGravityY = (targetY - node.y) * 0.04;
            node.vy += hierarchicalGravityY;
          }

          // Zero floating drift for active timeline nodes to keep them steady
          const isNodeActive = activeTreeSet && activeTreeSet.has(node.task.id);
          const driftMult = isNodeActive ? (isTimelineMode ? 0 : 0.005) : 0.03;
          const driftX = Math.cos(nowTime * 0.8 + idx * 1.5) * driftMult;
          const driftY = Math.sin(nowTime * 0.7 + idx * 2.1) * driftMult;

          node.vx += driftX;
          node.vy += driftY;

          // Strong velocity damping (0.78) prevents oscillation & wobble
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
            const isSubtreeEdge = activeTreeSet && activeTreeSet.has(node.task.id) && activeTreeSet.has(parentNode.task.id);
            const isDimmedEdge = activeTreeSet && !isSubtreeEdge;

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
              // Smooth Bézier curve for timeline connections
              const metrics = getTimelineLayoutMetrics(width);
              const isNodeOutside = node.x < metrics.timelineStartX || node.x > metrics.timelineEndX;
              const isParentOutside = parentNode.x < metrics.timelineStartX || parentNode.x > metrics.timelineEndX;
              const isCrossZone = isNodeOutside || isParentOutside;

              const cp1x = node.x + dx * 0.45;
              const cp1y = node.y;
              const cp2x = parentNode.x - dx * 0.45;
              const cp2y = parentNode.y;

              ctx.beginPath();
              ctx.moveTo(node.x, node.y);
              ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, parentNode.x, parentNode.y);

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

              // Directional arrow on Bézier curve pointing Parent -> Child
              // Sample at t = 0.62 along Parent(t=0) -> Child(t=1)
              const t = 0.62;
              const u = 1 - t;
              const q0x = parentNode.x, q0y = parentNode.y;
              const q1x = cp2x, q1y = cp2y;
              const q2x = cp1x, q2y = cp1y;
              const q3x = node.x, q3y = node.y;

              const ax = u*u*u*q0x + 3*u*u*t*q1x + 3*u*t*t*q2x + t*t*t*q3x;
              const ay = u*u*u*q0y + 3*u*u*t*q1y + 3*u*t*t*q2y + t*t*t*q3y;

              const dtx = 3*u*u*(q1x - q0x) + 6*u*t*(q2x - q1x) + 3*t*t*(q3x - q2x);
              const dty = 3*u*u*(q1y - q0y) + 6*u*t*(q2y - q1y) + 3*t*t*(q3y - q2y);
              const dlen = Math.hypot(dtx, dty) || 1;
              const tux = dtx / dlen;
              const tuy = dty / dlen;
              const tnx = -tuy;
              const tny = tux;

              ctx.beginPath();
              ctx.moveTo(ax + tux * 4, ay + tuy * 4);
              ctx.lineTo(ax - tux * 6 + tnx * 3.5, ay - tuy * 6 + tny * 3.5);
              ctx.lineTo(ax - tux * 6 - tnx * 3.5, ay - tuy * 6 - tny * 3.5);
              ctx.closePath();
              ctx.fillStyle = edgeColor;
              ctx.fill();

            } else {
              // Standard graph edge (Parent -> Child)
              ctx.beginPath();
              ctx.moveTo(parentNode.x, parentNode.y);
              ctx.lineTo(node.x, node.y);

              let edgeColor = isSubtreeEdge
                ? '#f59e0b'
                : (isLight ? 'rgba(0, 0, 0, 0.22)' : 'rgba(255, 255, 255, 0.25)');
              let edgeWidth = isSubtreeEdge ? 2.5 : 1.5;

              if (isLineageEdge) {
                edgeColor = '#f59e0b';
                edgeWidth = 3.2;
                ctx.shadowColor = '#f59e0b';
                ctx.shadowBlur = 10;
              } else if (activeLineageId) {
                ctx.globalAlpha = 0.2;
              } else if (isDimmedEdge) {
                ctx.globalAlpha = 0.12;
              }

              ctx.strokeStyle = edgeColor;
              ctx.lineWidth = edgeWidth;
              ctx.setLineDash(isSubtreeEdge ? [] : [4, 4]);
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

      // Draw Nodes
      graphNodes.forEach((node) => {
        let nodeColor = isLight ? '#64748b' : '#a1a1aa';
        if (node.task.status === 'IN_PROGRESS') nodeColor = '#f59e0b';
        if (node.task.status === 'DONE') nodeColor = '#10b981';

        const isSelectedRoot = selectedId === node.task.id;
        const isInSubtree = activeTreeSet ? activeTreeSet.has(node.task.id) : true;
        const isDimmed = activeTreeSet && !isInSubtree;

        const childCount = currentTasks.filter((t) => t.parentId === node.task.id).length;
        const baseRadius = 9;
        const coreRadius = baseRadius + Math.min(childCount * 4, 16);
        const haloRadius = coreRadius + (isSelectedRoot ? 12 : (isInSubtree && activeTreeSet ? 8 : 5));

        ctx.globalAlpha = isDimmed ? 0.2 : 1.0;

        // Halo
        ctx.beginPath();
        ctx.arc(node.x, node.y, haloRadius, 0, Math.PI * 2);
        ctx.fillStyle = isSelectedRoot ? '#f59e0b' : nodeColor;
        ctx.globalAlpha = isDimmed ? 0.08 : (isSelectedRoot ? 0.45 : 0.18);
        ctx.fill();

        // Core Circle
        ctx.beginPath();
        ctx.arc(node.x, node.y, coreRadius, 0, Math.PI * 2);
        ctx.globalAlpha = isDimmed ? 0.25 : 1.0;
        ctx.fillStyle = nodeColor;
        ctx.fill();

        if (isSelectedRoot || (isInSubtree && activeTreeSet)) {
          ctx.strokeStyle = isSelectedRoot ? (isLight ? '#18181b' : '#ffffff') : '#f59e0b';
          ctx.lineWidth = isSelectedRoot ? 2.8 : 1.8;
          ctx.stroke();
        }

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
        const fontWeight = isSelectedRoot ? 'bold' : (isInSubtree && activeTreeSet ? '500' : '400');
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
        // - timeline (Zone 3 visible range) or normal mode: bottom of node circle
        let targetLX, targetLY;
        if (timelineZone === 'future') {
          targetLX = node.x - haloRadius - 8;
          targetLY = node.y;
        } else if (timelineZone === 'past' || timelineZone === 'unscheduled') {
          targetLX = node.x + haloRadius + 8;
          targetLY = node.y;
        } else {
          targetLX = node.x;
          targetLY = node.y + haloRadius + fontSize + 3;
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

        const lx = node.labelX;
        const ly = node.labelY;

        // Label Background Plate rendered at physical label coordinates (lx, ly)
        ctx.fillStyle = isLight ? 'rgba(250, 250, 250, 0.94)' : 'rgba(9, 9, 11, 0.94)';
        ctx.globalAlpha = isDimmed ? 0.2 : 0.94;
        ctx.strokeStyle = isSelectedRoot ? 'rgba(245, 158, 11, 0.6)' : (isLight ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.12)');
        ctx.lineWidth = 1;

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
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(lx - textWidth / 2 - 4, ly - fontSize, textWidth + 8, plateHeight, 4);
          } else {
            ctx.rect(lx - textWidth / 2 - 4, ly - fontSize, textWidth + 8, plateHeight);
          }
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = isDimmed ? (isLight ? '#94a3b8' : '#52525b') : (isLight ? '#18181b' : '#f4f4f5');
          ctx.globalAlpha = isDimmed ? 0.3 : 1.0;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'alphabetic';
          ctx.fillText(labelText, lx, ly - 2);
        }
        ctx.globalAlpha = 1.0;
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


      ctx.restore();
      canvasAnimationId = requestAnimationFrame(animate);
    }

    animate();
    setupCanvasInteractivity();
  }

  function setupCanvasInteractivity() {
    let isMouseDown = false;
    let clickStartX = 0;
    let clickStartY = 0;
    let lastClickTime = 0;
    let lastClickNodeId = null;

    canvas.onmousedown = (e) => {
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      clickStartX = e.clientX;
      clickStartY = e.clientY;

      const hitNode = graphNodes.find((n) => Math.hypot(n.x - mouseX, n.y - mouseY) <= 28);
      if (hitNode) {
        isMouseDown = true;
        draggedGraphNode = hitNode;
        hitNode.isPinned = true;
      } else {
        const selectedId = doubleClickedSubtreeId || focusedTaskId || inspectorSelectedTaskId;
        if (selectedId) {
          isPanningCanvas = true;
          panStartX = e.clientX;
          hasPanned = false;
        }
      }
    };

    canvas.onmousemove = (e) => {
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      if (isMouseDown && draggedGraphNode) {
        draggedGraphNode.x = mouseX;
        draggedGraphNode.y = mouseY;
      } else if (isPanningCanvas) {
        const deltaX = e.clientX - panStartX;
        if (Math.abs(e.clientX - clickStartX) > 4) {
          hasPanned = true;
        }
        canvasPanOffsetX += deltaX;
        panStartX = e.clientX;
      } else {
        const hit = graphNodes.find((n) => Math.hypot(n.x - mouseX, n.y - mouseY) <= 28);
        hoveredNodeId = hit ? hit.task.id : null;
        canvas.style.cursor = hit ? 'pointer' : 'default';
      }
    };

    canvas.onmouseleave = () => {
      hoveredNodeId = null;
      canvas.style.cursor = 'default';
    };

    canvas.onmouseup = (e) => {
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

      // Check click on "↺ 今日へ戻る" button in timeline mode
      const selectedId = doubleClickedSubtreeId || focusedTaskId || inspectorSelectedTaskId;
      const activeTreeSet = selectedId ? getDescendantIds(selectedId) : null;
      const isTimelineMode = Boolean(selectedId && activeTreeSet);
      const cssWidth = canvas.width / (window.devicePixelRatio || 1);
      const metrics = getTimelineLayoutMetrics(cssWidth);

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
            // DOUBLE CLICK: Subtree Focus Mode!
            doubleClickedSubtreeId = task.id;
            lastClickTime = 0;
            lastClickNodeId = null;
            canvasPanOffsetX = 0;
            openObsidianNodeInspector(task);
            renderCurrentView();
            return;
          }

          lastClickTime = now;
          lastClickNodeId = task.id;
          canvasPanOffsetX = 0;
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
      const selectedId = doubleClickedSubtreeId || focusedTaskId || inspectorSelectedTaskId;
      if (selectedId) {
        e.preventDefault();
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        canvasPanOffsetX -= delta * 0.7;
      }
    };
  }

  // Obsidian Node Inspector Open & Logic
  function openObsidianNodeInspector(task) {
    if (!obsidianInspector) return;

    inspectorSelectedTaskId = task.id;
    focusedTaskId = task.id;

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
            if (doubleClickedSubtreeId) {
              doubleClickedSubtreeId = anc.id;
            }
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

  initTheme();
  setupKeyboardNavigation();
  initWebSocket();
})();
