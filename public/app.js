(function () {
  let socket = null;
  let currentTasks = [];
  let currentEvents = [];
  let focusedTaskId = null;
  let inspectorSelectedTaskId = null;

  // View Modes: 'OBSIDIAN_GRAPH_VIEW' | 'GANTT_VIEW'
  let currentViewMode = 'OBSIDIAN_GRAPH_VIEW';

  // Edge Nest Depth Filter (1, 2, 3... or 'all')
  let currentMaxDepth = 'all';

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

  // Dynamic Y Ratio calculation automatically adjusting to the max visible nest depth
  function computeDynamicYRatio(depth, maxTreeDepth, isSelectedTree = false) {
    const topY = 0.18;
    const bottomY = isSelectedTree ? 0.82 : 0.85;

    if (maxTreeDepth <= 0) {
      return 0.45; // Center single-level tasks vertically
    }

    const ratio = Math.min(1, Math.max(0, depth / maxTreeDepth));
    return topY + ratio * (bottomY - topY);
  }

  // Sugiyama Layered Tree Layout Helper (Calculates non-overlapping X columns for subtrees)
  function computeSugiyamaTreeXPositions(visibleTasks, width) {
    const parentToChildren = new Map();
    visibleTasks.forEach((t) => {
      const pId = t.parentId || '__ROOT__';
      if (!parentToChildren.has(pId)) parentToChildren.set(pId, []);
      parentToChildren.get(pId).push(t);
    });

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

    const xPosMap = new Map();
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

  const btnViewGraph = document.getElementById('btn-view-graph');
  const btnViewGantt = document.getElementById('btn-view-gantt');

  const quickForm = document.getElementById('quick-task-form');
  const quickInputTitle = document.getElementById('quick-title-input');
  const selectQuickParent = document.getElementById('select-quick-parent');

  const obsidianGraphViewSection = document.getElementById('obsidian-graph-view');
  const canvas = document.getElementById('obsidian-canvas');

  const graphParentNav = document.getElementById('graph-parent-nav');
  const parentNavTitle = document.getElementById('parent-nav-title');
  const btnGraphGoParent = document.getElementById('btn-graph-go-parent');

  const obsidianInspector = document.getElementById('obsidian-inspector');
  const inspectorStatusBadge = document.getElementById('inspector-status-badge');
  const inspectorTitleInput = document.getElementById('inspector-title-input');
  const inspectorDueDateInput = document.getElementById('inspector-due-date-input');
  const btnInspectorClose = document.getElementById('btn-inspector-close');
  const btnInspectorElevate = document.getElementById('btn-inspector-elevate');
  const btnInspectorDelete = document.getElementById('btn-inspector-delete');

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

  const ganttViewSection = document.getElementById('gantt-view');
  const ganttContainer = document.getElementById('gantt-container');
  const ganttStatsBadge = document.getElementById('gantt-stats-badge');

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

  function showErrorToast(msg) {
    errorToast.textContent = msg;
    errorToast.classList.remove('hidden');
    setTimeout(() => {
      errorToast.classList.add('hidden');
    }, 4000);
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

  // 2-Mode View Buttons Setup
  if (btnViewGraph) {
    btnViewGraph.addEventListener('click', () => setViewMode('OBSIDIAN_GRAPH_VIEW'));
  }
  if (btnViewGantt) {
    btnViewGantt.addEventListener('click', () => setViewMode('GANTT_VIEW'));
  }

  // Graph Overlay Control Panel (Depth Filter + Font Size Filter)
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

  function setViewMode(mode) {
    currentViewMode = mode;

    if (btnViewGraph) btnViewGraph.classList.toggle('active', mode === 'OBSIDIAN_GRAPH_VIEW');
    if (btnViewGantt) btnViewGantt.classList.toggle('active', mode === 'GANTT_VIEW');

    if (obsidianGraphViewSection) obsidianGraphViewSection.classList.toggle('hidden', mode !== 'OBSIDIAN_GRAPH_VIEW');
    if (ganttViewSection) ganttViewSection.classList.toggle('hidden', mode !== 'GANTT_VIEW');

    if (mode !== 'OBSIDIAN_GRAPH_VIEW' && obsidianInspector) {
      obsidianInspector.classList.add('hidden');
    }

    requestAnimationFrame(() => {
      renderCurrentView();
    });
  }

  function renderCurrentView() {
    if (canvasAnimationId) {
      cancelAnimationFrame(canvasAnimationId);
      canvasAnimationId = null;
    }

    if (currentViewMode === 'OBSIDIAN_GRAPH_VIEW') {
      startObsidianGraphRenderer();
    } else if (currentViewMode === 'GANTT_VIEW') {
      renderGanttView();
    }
  }

  // --------------------------------------------------------------------------
  // VIEW 1: Obsidian Canvas View & Node Click Quick Inspector
  // --------------------------------------------------------------------------
  function startObsidianGraphRenderer() {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

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

    const visibleTasks = currentTasks.filter((task) => {
      if (currentMaxDepth === 'all') return true;
      return getTaskDepth(task) < currentMaxDepth;
    });

    const maxVisibleDepth = visibleTasks.reduce((max, t) => Math.max(max, getTaskDepth(t)), 0);
    const existingNodeMap = new Map(graphNodes.map((n) => [n.task.id, n]));
    const sugiyamaXMap = computeSugiyamaTreeXPositions(visibleTasks, width);

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

      // Sugiyama Layered Layout Alignment Force (Pulls nodes to dedicated non-crossing columns)
      const sugiyamaXMap = computeSugiyamaTreeXPositions(visibleTasks, width);

      graphNodes.forEach((node) => {
        if (!node.isPinned) {
          const targetX = sugiyamaXMap.get(node.task.id);
          if (targetX !== undefined) {
            node.vx += (targetX - node.x) * 0.045;
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

          // 1. Gentle Center Circle Repulsion
          if (dist < minRepelDist) {
            const force = ((minRepelDist - dist) / minRepelDist) * 0.6;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;

            nodeA.vx -= fx;
            nodeA.vy -= fy;
            nodeB.vx += fx;
            nodeB.vy += fy;
          }

          // 2. Soft Text Label Overlap Prevention (Gentle non-shaking force)
          ctx.font = `11px Inter, sans-serif`;
          const textWA = ctx.measureText(nodeA.task.title).width;
          const textWB = ctx.measureText(nodeB.task.title).width;

          const reqLabelWidth = (textWA + textWB) / 2 + 20;
          const reqLabelHeight = 50;

          const absDx = Math.abs(dx);
          const absDy = Math.abs(dy);

          if (absDx < reqLabelWidth && absDy < reqLabelHeight) {
            const overlapX = (reqLabelWidth - absDx) / reqLabelWidth;
            const overlapY = (reqLabelHeight - absDy) / reqLabelHeight;
            const repelStrength = Math.min(overlapX, overlapY) * 0.35;

            const signX = dx >= 0 ? 1 : -1;
            const signY = dy >= 0 ? 1 : -1;

            nodeA.vx -= signX * overlapX * repelStrength;
            nodeA.vy -= signY * overlapY * repelStrength;
            nodeB.vx += signX * overlapX * repelStrength;
            nodeB.vy += signY * overlapY * repelStrength;
          }
        }
      }

      const selectedId = focusedTaskId || inspectorSelectedTaskId;
      const activeTreeSet = selectedId ? getDescendantIds(selectedId) : null;
      const maxVisibleDepth = visibleTasks.reduce((max, t) => Math.max(max, getTaskDepth(t)), 0);

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

      const nowTime = Date.now() * 0.0012;
      graphNodes.forEach((node, idx) => {
        if (!node.isPinned) {
          let targetYRatio;

          if (selectedId && activeTreeSet) {
            const relDepth = getRelativeDepth(node.task, selectedId);
            if (relDepth !== null) {
              // Elevate selected node to topY and scale subtree evenly down to bottomY
              targetYRatio = computeDynamicYRatio(relDepth, maxSubtreeRelDepth, true);
            } else {
              // Unfocused background nodes sink slightly (+0.04) to highlight selected subtree
              const depth = getTaskDepth(node.task);
              targetYRatio = Math.min(0.92, computeDynamicYRatio(depth, maxVisibleDepth, false) + 0.04);
            }
          } else {
            // Normal view with dynamic vertical scaling according to maxVisibleDepth
            const depth = getTaskDepth(node.task);
            targetYRatio = computeDynamicYRatio(depth, maxVisibleDepth, false);
          }

          const targetY = height * targetYRatio;
          const hierarchicalGravityY = (targetY - node.y) * 0.04;
          node.vy += hierarchicalGravityY;

          // Zero floating drift for active tree nodes to keep focused tree completely steady
          const isNodeActive = activeTreeSet && activeTreeSet.has(node.task.id);
          const driftMult = isNodeActive ? 0.005 : 0.03;
          const driftX = Math.cos(nowTime * 0.8 + idx * 1.5) * driftMult;
          const driftY = Math.sin(nowTime * 0.7 + idx * 2.1) * driftMult;

          node.vx += driftX;
          node.vy += driftY;

          // Strong velocity damping (0.78) prevents oscillation & wobble
          node.vx *= 0.78;
          node.vy *= 0.78;

          node.x += node.vx;
          node.y += node.vy;

          const pad = 60;
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

            ctx.beginPath();
            ctx.moveTo(node.x, node.y);
            ctx.lineTo(parentNode.x, parentNode.y);
            ctx.strokeStyle = isSubtreeEdge
              ? '#f59e0b'
              : (isLight ? 'rgba(0, 0, 0, 0.22)' : 'rgba(255, 255, 255, 0.25)');
            ctx.lineWidth = isSubtreeEdge ? 2.5 : 1.5;
            ctx.globalAlpha = isDimmedEdge ? 0.12 : 1.0;
            ctx.setLineDash(isSubtreeEdge ? [] : [4, 4]);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.globalAlpha = 1.0;
          }
        }
      });

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

        const textMetrics = ctx.measureText(node.task.title);
        const textWidth = textMetrics.width;
        const plateHeight = fontSize + 4;
        const labelX = node.x;
        // Text Label Steady Alignment Physics Update
        const targetLX = node.x;
        const targetLY = node.y + haloRadius + fontSize + 3;

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
        ctx.fillStyle = isLight ? 'rgba(250, 250, 250, 0.92)' : 'rgba(9, 9, 11, 0.92)';
        ctx.globalAlpha = isDimmed ? 0.2 : 0.92;
        ctx.fillRect(lx - textWidth / 2 - 4, ly - fontSize, textWidth + 8, plateHeight);

        ctx.strokeStyle = isSelectedRoot ? 'rgba(245, 158, 11, 0.6)' : (isLight ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.12)');
        ctx.lineWidth = 1;
        ctx.strokeRect(lx - textWidth / 2 - 4, ly - fontSize, textWidth + 8, plateHeight);

        ctx.fillStyle = isDimmed ? (isLight ? '#94a3b8' : '#52525b') : (isLight ? '#18181b' : '#f4f4f5');
        ctx.globalAlpha = isDimmed ? 0.3 : 1.0;
        ctx.textAlign = 'center';
        ctx.fillText(node.task.title, lx, ly - 2);
        ctx.globalAlpha = 1.0;
      });

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
      }
    };

    canvas.onmousemove = (e) => {
      if (isMouseDown && draggedGraphNode) {
        const rect = canvas.getBoundingClientRect();
        draggedGraphNode.x = e.clientX - rect.left;
        draggedGraphNode.y = e.clientY - rect.top;
      }
    };

    canvas.onmouseup = (e) => {
      const dist = Math.hypot(e.clientX - clickStartX, e.clientY - clickStartY);
      if (draggedGraphNode) {
        draggedGraphNode.isPinned = false;

        // Check in-canvas top strip drop for elevating to root
        const droppedOnTopStrip = draggedGraphNode.y <= 65;

        if (droppedOnTopStrip && draggedGraphNode.task.parentId) {
          changeTaskParent(draggedGraphNode.task.id, null);
        } else if (dist < 5) {
          // Click Node: Open Node Inspector
          const task = draggedGraphNode.task;
          openObsidianNodeInspector(task);
        } else if (!droppedOnTopStrip) {
          // Dragged Node: Check drop target on another node
          const targetNode = graphNodes.find(
            (n) => n.task.id !== draggedGraphNode.task.id && Math.hypot(n.x - draggedGraphNode.x, n.y - draggedGraphNode.y) <= 45
          );

          if (targetNode) {
            if (isDescendantOf(targetNode.task.id, draggedGraphNode.task.id)) {
              showErrorToast('親タスクを自己の子孫タスクの中に移動することはできません。');
            } else {
              promptParentingConfirmation(draggedGraphNode.task, targetNode.task);
            }
          }
        }
      } else if (dist < 5) {
        // Click on empty canvas background: deselect focus and close inspector
        closeObsidianNodeInspector();
        focusedTaskId = null;
        renderCurrentView();
      }
      isMouseDown = false;
      draggedGraphNode = null;
    };
  }

  // Obsidian Node Inspector Open & Logic
  function openObsidianNodeInspector(task) {
    if (!obsidianInspector) return;

    inspectorSelectedTaskId = task.id;
    focusedTaskId = task.id;

    if (task.parentId && graphParentNav && parentNavTitle && btnGraphGoParent) {
      const parentTask = currentTasks.find((t) => t.id === task.parentId);
      if (parentTask) {
        parentNavTitle.textContent = parentTask.title;
        graphParentNav.classList.remove('hidden');
        btnGraphGoParent.onclick = (e) => {
          e.stopPropagation();
          openObsidianNodeInspector(parentTask);
          renderCurrentView();
        };
      } else {
        graphParentNav.classList.add('hidden');
      }
    } else if (graphParentNav) {
      graphParentNav.classList.add('hidden');
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
    if (graphParentNav) {
      graphParentNav.classList.add('hidden');
    }
    inspectorSelectedTaskId = null;
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
      const val = inspectorDueDateInput.value;
      const dueDateTs = val ? new Date(val + 'T23:59:59').getTime() : null;
      updateTaskDueDate(inspectorSelectedTaskId, dueDateTs);
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
  // VIEW 2: Gantt Chart Timeline View (Tree Structure + Due Dates + Duration)
  // --------------------------------------------------------------------------
  function renderGanttView() {
    if (!ganttContainer) return;
    ganttContainer.innerHTML = '';

    if (ganttStatsBadge) {
      ganttStatsBadge.textContent = `全タスク: ${currentTasks.length}件 / イベント数: ${currentEvents.length}件`;
    }

    if (currentTasks.length === 0) {
      const notice = document.createElement('div');
      notice.className = 'gantt-empty-notice';
      notice.textContent = 'タスクがありません。下部の入力バーから新しいタスクを作成してください。';
      ganttContainer.appendChild(notice);
      return;
    }

    // Build Tree-Ordered Task Array (Depth First Order)
    const treeOrderedTasks = [];
    function collectTreeTasks(parentId = null, level = 0) {
      const children = currentTasks.filter((t) => (parentId ? t.parentId === parentId : (!t.parentId || !currentTasks.some((p) => p.id === t.parentId))))
        .sort((a, b) => a.orderIndex - b.orderIndex);

      children.forEach((child) => {
        treeOrderedTasks.push({ task: child, level });
        collectTreeTasks(child.id, level + 1);
      });
    }
    collectTreeTasks(null, 0);

    // Compute Timeline Bounds (Start to Target Due Date / Finish / Current Time)
    const now = Date.now();
    let minTime = Infinity;
    let maxTime = -Infinity;

    treeOrderedTasks.forEach(({ task }) => {
      const created = task.createdAt || now;
      if (created < minTime) minTime = created;
      if (task.updatedAt && task.updatedAt > maxTime) maxTime = task.updatedAt;
      if (task.dueDate && task.dueDate > maxTime) maxTime = task.dueDate;
    });

    // Ensure timeline bounds fit the furthest completion due date with padding
    const maxDueDate = Math.max(...currentTasks.map((t) => t.dueDate || 0), 0);
    if (maxDueDate > 0) {
      maxTime = Math.max(maxTime, maxDueDate + 86400000 * 2);
    }

    if (minTime === Infinity) minTime = now - 86400000 * 7;
    // Default at least 30-day timeline span
    const thirtyDaysMs = 86400000 * 30;
    if (maxTime < minTime + thirtyDaysMs) {
      maxTime = minTime + thirtyDaysMs;
    }

    const totalSpan = maxTime - minTime;

    // Render Timeline Ticks (5 Date Markers)
    const ticksHeader = document.createElement('div');
    ticksHeader.className = 'gantt-ticks-header';
    ticksHeader.style.cssText = 'margin-left: 52%; width: 48%; box-sizing: border-box;';
    const numTicks = 5;
    for (let i = 0; i < numTicks; i++) {
      const tickTime = minTime + (totalSpan * i) / (numTicks - 1);
      const d = new Date(tickTime);
      const span = document.createElement('span');
      span.textContent = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
      ticksHeader.appendChild(span);
    }

    const table = document.createElement('table');
    table.className = 'gantt-table';

    const thead = document.createElement('thead');
    thead.innerHTML = `
      <tr>
        <th style="width: 28%;">ツリータスク名</th>
        <th style="width: 11%;">ステータス</th>
        <th style="width: 13%;">完了予定日</th>
        <th class="gantt-bar-cell" style="width: 48%;">時系列タイムライン & 予定マーカー (🚩)</th>
      </tr>
    `;
    table.appendChild(thead);

    const tbody = document.createElement('tbody');

    treeOrderedTasks.forEach(({ task, level }) => {
      const tr = document.createElement('tr');
      const indentStr = level > 0 ? '│  '.repeat(level - 1) + '├─ ' : '';
      const statusLabels = { TODO: '未着手', IN_PROGRESS: '進行中', DONE: '完了' };

      // Format Due Date
      let dueDateStr = '-';
      let isOverdue = false;
      if (task.dueDate) {
        const d = new Date(task.dueDate);
        dueDateStr = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
        if (task.status !== 'DONE' && task.dueDate < now) {
          isOverdue = true;
        }
      }

      // Check if child task overdue past parent due date
      let overdueBadgeHtml = '';
      let overdueBarHtml = '';
      if (task.parentId && task.dueDate) {
        const parentTask = currentTasks.find((p) => p.id === task.parentId);
        if (parentTask && parentTask.dueDate && task.dueDate > parentTask.dueDate) {
          const delayMs = task.dueDate - parentTask.dueDate;
          const delayDays = Math.ceil(delayMs / 86400000);
          overdueBadgeHtml = `<span class="gantt-delay-badge" title="親タスクの完了予定日を${delayDays}日超過">+${delayDays}日遅延</span>`;

          const parentDuePct = Math.max(0, Math.min(100, ((parentTask.dueDate - minTime) / totalSpan) * 100));
          const childDuePct = Math.max(0, Math.min(100, ((task.dueDate - minTime) / totalSpan) * 100));
          const overWidthPct = Math.max(1, childDuePct - parentDuePct);
          overdueBarHtml = `<div class="gantt-overdue-bar" style="left: ${parentDuePct.toFixed(1)}%; width: ${overWidthPct.toFixed(1)}%;" title="親の完了予定日を${delayDays}日超過"></div>`;
        }
      }

      // Bar timing calculation
      const startTime = task.createdAt || minTime;
      const endTime = task.status === 'DONE' ? (task.updatedAt || now) : Math.max(now, task.dueDate || now);

      let startPct = Math.max(0, Math.min(100, ((startTime - minTime) / totalSpan) * 100));
      let endPct = Math.max(startPct + 2, Math.min(100, ((endTime - minTime) / totalSpan) * 100));
      let widthPct = Math.max(2, endPct - startPct);

      // Duration in days calculation
      const durationMs = Math.max(86400000, endTime - startTime);
      const durationDays = Math.ceil(durationMs / 86400000);

      // Target Due Date Marker Position
      let dueMarkerHtml = '';
      if (task.dueDate) {
        const duePct = Math.max(0, Math.min(100, ((task.dueDate - minTime) / totalSpan) * 100));
        dueMarkerHtml = `<div class="gantt-due-marker" style="left: ${duePct.toFixed(1)}%;" title="完了予定日: ${dueDateStr}"></div>`;
      }

      // Render Row
      const taskTd = document.createElement('td');
      taskTd.className = 'gantt-task-name';
      taskTd.innerHTML = `<span class="gantt-tree-indent">${indentStr}</span>${task.title}${overdueBadgeHtml}`;

      const statusTd = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = 'inspector-badge';
      badge.dataset.status = task.status;
      badge.textContent = statusLabels[task.status] || task.status;
      badge.title = 'クリックでステータス変更';
      badge.onclick = (e) => {
        e.stopPropagation();
        const nextStatusMap = { TODO: 'IN_PROGRESS', IN_PROGRESS: 'DONE', DONE: 'TODO' };
        updateTaskStatus(task.id, nextStatusMap[task.status] || 'TODO');
      };
      statusTd.appendChild(badge);

      const dueTd = document.createElement('td');
      if (task.dueDate) {
        dueTd.innerHTML = `<span class="gantt-due-pill ${isOverdue ? 'overdue' : ''}">${isOverdue ? '⚠️ ' : ''}${dueDateStr}</span>`;
      } else {
        dueTd.style.cssText = 'color: var(--text-muted); font-size: 0.75rem;';
        dueTd.textContent = '-';
      }

      const barTd = document.createElement('td');
      barTd.className = 'gantt-bar-cell';
      barTd.innerHTML = `
        <div class="gantt-bar-track">
          <div class="gantt-bar-fill" data-status="${task.status}" style="left: ${startPct.toFixed(1)}%; width: ${widthPct.toFixed(1)}%;" title="期間: 約${durationDays}日間 (${statusLabels[task.status]})">
            ${durationDays > 1 ? `${durationDays}日` : ''}
          </div>
          ${overdueBarHtml}
          ${dueMarkerHtml}
        </div>
      `;

      // Allow clicking bar to open inspector
      const barFill = barTd.querySelector('.gantt-bar-fill');
      if (barFill) {
        barFill.onclick = (e) => {
          e.stopPropagation();
          setViewMode('OBSIDIAN_GRAPH_VIEW');
          openObsidianNodeInspector(task);
        };
      }

      // Allow dragging Gantt completion due date marker (🚩) to update dueDate
      const dueMarkerEl = barTd.querySelector('.gantt-due-marker');
      if (dueMarkerEl) {
        dueMarkerEl.onmousedown = (e) => {
          e.stopPropagation();
          e.preventDefault();

          const track = barTd.querySelector('.gantt-bar-track');
          if (!track) return;

          dueMarkerEl.classList.add('dragging');

          let tooltip = document.querySelector('.gantt-drag-tooltip');
          if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.className = 'gantt-drag-tooltip';
            document.body.appendChild(tooltip);
          }

          let pendingDateTs = task.dueDate;

          const onMouseMove = (moveEvt) => {
            const rect = track.getBoundingClientRect();
            const relX = Math.max(0, Math.min(rect.width, moveEvt.clientX - rect.left));
            const ratio = relX / rect.width;
            pendingDateTs = minTime + ratio * totalSpan;

            const dateObj = new Date(pendingDateTs);
            const dateStr = `${dateObj.getFullYear()}/${String(dateObj.getMonth() + 1).padStart(2, '0')}/${String(dateObj.getDate()).padStart(2, '0')}`;

            dueMarkerEl.style.left = `${(ratio * 100).toFixed(1)}%`;
            tooltip.textContent = `完了予定日: ${dateStr}`;
            tooltip.style.left = `${moveEvt.clientX}px`;
            tooltip.style.top = `${moveEvt.clientY}px`;
            tooltip.style.display = 'block';
          };

          const onMouseUp = () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            dueMarkerEl.classList.remove('dragging');
            if (tooltip) {
              tooltip.remove();
            }

            if (pendingDateTs) {
              const d = new Date(pendingDateTs);
              d.setHours(23, 59, 59, 999);
              updateTaskDueDate(task.id, d.getTime());
            }
          };

          window.addEventListener('mousemove', onMouseMove);
          window.addEventListener('mouseup', onMouseUp);
        };
      }

      tr.appendChild(taskTd);
      tr.appendChild(statusTd);
      tr.appendChild(dueTd);
      tr.appendChild(barTd);
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);

    const ganttWrapper = document.createElement('div');
    ganttWrapper.appendChild(ticksHeader);
    ganttWrapper.appendChild(table);

    ganttContainer.appendChild(ganttWrapper);
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

  function promptActionConfirmation({ title = '確認', message = '', onConfirm = () => {} }) {
    if (confirmModalTitle) confirmModalTitle.textContent = title;
    confirmModalText.textContent = message;
    pendingActionCallback = onConfirm;
    confirmModal.classList.remove('hidden');
  }

  function promptParentingConfirmation(childTask, parentTask) {
    promptActionConfirmation({
      title: '親タスク設定の確認',
      message: `タスク「${childTask.title}」を「${parentTask.title}」の子タスクに変更しますか？ (Enterキーで実行)`,
      onConfirm: () => changeTaskParent(childTask.id, parentTask.id),
    });
  }

  if (btnModalCancel) {
    btnModalCancel.onclick = () => {
      confirmModal.classList.add('hidden');
      pendingActionCallback = null;
    };
  }

  if (btnModalConfirm) {
    btnModalConfirm.onclick = () => {
      if (pendingActionCallback) {
        pendingActionCallback();
      }
      confirmModal.classList.add('hidden');
      pendingActionCallback = null;
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

    if (confirm(`タスク「${task.title}」を削除しますか？`)) {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({
            action: 'DELETE_TASK',
            taskId,
          })
        );
      }
      closeObsidianNodeInspector();
    }
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
