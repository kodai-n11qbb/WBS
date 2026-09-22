(function () {
  let socket = null;
  let currentTasks = [];
  let currentEvents = [];
  let focusedTaskId = null;
  let inspectorSelectedTaskId = null;

  // View Modes: 'OBSIDIAN_GRAPH_VIEW' | 'GANTT_VIEW'
  let currentViewMode = 'OBSIDIAN_GRAPH_VIEW';

  // Edge Nest Depth Filter (1, 2, 3... or 'all')
  let currentMaxDepth = 2;

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

  // Canvas Animation Frame & Physics State
  let canvasAnimationId = null;
  let graphNodes = [];
  let draggedGraphNode = null;

  // DOM Elements
  const nodeDisplay = document.getElementById('node-id-display');
  const errorToast = document.getElementById('error-toast');

  const btnViewGraph = document.getElementById('btn-view-graph');
  const btnViewGantt = document.getElementById('btn-view-gantt');

  const quickForm = document.getElementById('quick-task-form');
  const quickInputTitle = document.getElementById('quick-title-input');
  const selectQuickParent = document.getElementById('select-quick-parent');

  const obsidianGraphViewSection = document.getElementById('obsidian-graph-view');
  const canvas = document.getElementById('obsidian-canvas');

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

  // Depth Filter Controls Setup
  const depthButtons = document.querySelectorAll('.depth-btn');
  depthButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      depthButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const val = btn.dataset.depth;
      currentMaxDepth = val === 'all' ? 'all' : parseInt(val, 10);
      renderCurrentView();
    });
  });

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
    const width = rect.width || wrapper.clientWidth || 1200;
    const height = rect.height || wrapper.clientHeight || 600;

    canvas.width = Math.max(width, 300);
    canvas.height = Math.max(height, 300);

    const visibleTasks = currentTasks.filter((task) => {
      if (currentMaxDepth === 'all') return true;
      return getTaskDepth(task) < currentMaxDepth;
    });

    const existingNodeMap = new Map(graphNodes.map((n) => [n.task.id, n]));

    graphNodes = visibleTasks.map((task, idx) => {
      const existing = existingNodeMap.get(task.id);
      if (existing) {
        existing.task = task;
        return existing;
      }

      const depth = getTaskDepth(task);
      const angle = (idx / Math.max(1, visibleTasks.length)) * Math.PI * 2;
      const radius = Math.min(canvas.width, canvas.height) * 0.3;
      const centerX = canvas.width / 2;
      const targetYRatio = depth === 0 ? 0.22 : (depth === 1 ? 0.48 : (depth === 2 ? 0.72 : 0.88));
      const centerY = canvas.height * targetYRatio;

      return {
        task,
        x: centerX + Math.cos(angle) * (radius * 0.5),
        y: centerY + (Math.random() - 0.5) * 40,
        vx: (Math.random() - 0.5) * 0.2,
        vy: (Math.random() - 0.5) * 0.2,
        isPinned: false,
      };
    });

    const nodeMap = new Map(graphNodes.map((n) => [n.task.id, n]));

    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const isLight = document.documentElement.getAttribute('data-theme') === 'light';

      // Draw subtle background grid
      ctx.strokeStyle = isLight ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255, 255, 255, 0.04)';
      ctx.lineWidth = 1;
      const gridSize = 40;
      for (let x = 0; x < canvas.width; x += gridSize) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
      }
      for (let y = 0; y < canvas.height; y += gridSize) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
      }

      // Draw top in-canvas dropzone strip for drag-to-root
      if (draggedGraphNode && draggedGraphNode.task.parentId) {
        ctx.fillStyle = draggedGraphNode.y <= 60 ? (isLight ? 'rgba(16, 185, 129, 0.15)' : 'rgba(16, 185, 129, 0.25)') : (isLight ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.05)');
        ctx.strokeStyle = draggedGraphNode.y <= 60 ? '#10b981' : (isLight ? '#cbd5e1' : '#3f3f46');
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.fillRect(20, 10, canvas.width - 40, 50);
        ctx.strokeRect(20, 10, canvas.width - 40, 50);
        ctx.setLineDash([]);

        ctx.font = 'bold 13px Inter, sans-serif';
        ctx.fillStyle = draggedGraphNode.y <= 60 ? '#10b981' : (isLight ? '#64748b' : '#a1a1aa');
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('[ ここにドロップでルート要素 (親なし) に昇格 ]', canvas.width / 2, 35);
      }

      // Physics calculation
      graphNodes.forEach((node) => {
        if (node.task.parentId) {
          const parentNode = nodeMap.get(node.task.parentId);
          if (parentNode) {
            const dx = node.x - parentNode.x;
            const dy = node.y - parentNode.y;
            const dist = Math.hypot(dx, dy) || 1;
            const restLength = 130;
            const stiffness = 0.04;
            const force = (dist - restLength) * stiffness;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;

            if (!node.isPinned) {
              node.vx -= fx * 0.4;
              node.vy -= fy * 0.4;
            }
            if (!parentNode.isPinned) {
              parentNode.vx += fx * 0.4;
              parentNode.vy += fy * 0.4;
            }
          }
        }
      });

      const minRepelDist = 130;
      for (let i = 0; i < graphNodes.length; i++) {
        for (let j = i + 1; j < graphNodes.length; j++) {
          const nodeA = graphNodes[i];
          const nodeB = graphNodes[j];
          if (nodeA.isPinned || nodeB.isPinned) continue;

          const dx = nodeB.x - nodeA.x;
          const dy = nodeB.y - nodeA.y;
          const dist = Math.hypot(dx, dy) || 1;

          if (dist < minRepelDist) {
            const force = ((minRepelDist - dist) / minRepelDist) * 1.5;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;

            nodeA.vx -= fx;
            nodeA.vy -= fy;
            nodeB.vx += fx;
            nodeB.vy += fy;
          }
        }
      }

      const nowTime = Date.now() * 0.0012;
      graphNodes.forEach((node, idx) => {
        if (!node.isPinned) {
          const depth = getTaskDepth(node.task);
          const targetYRatio = depth === 0 ? 0.22 : (depth === 1 ? 0.48 : (depth === 2 ? 0.72 : 0.88));
          const targetY = canvas.height * targetYRatio;

          const hierarchicalGravityY = (targetY - node.y) * 0.015;
          node.vy += hierarchicalGravityY;

          const driftX = Math.cos(nowTime * 0.8 + idx * 1.5) * 0.06;
          const driftY = Math.sin(nowTime * 0.7 + idx * 2.1) * 0.06;

          node.vx += driftX;
          node.vy += driftY;

          node.vx *= 0.94;
          node.vy *= 0.94;

          node.x += node.vx;
          node.y += node.vy;

          const pad = 60;
          if (node.x < pad) { node.x = pad; node.vx *= -0.5; }
          if (node.x > canvas.width - pad) { node.x = canvas.width - pad; node.vx *= -0.5; }
          if (node.y < pad) { node.y = pad; node.vy *= -0.5; }
          if (node.y > canvas.height - pad) { node.y = canvas.height - pad; node.vy *= -0.5; }
        }
      });

      // Draw Edges
      graphNodes.forEach((node) => {
        if (node.task.parentId) {
          const parentNode = nodeMap.get(node.task.parentId);
          if (parentNode) {
            ctx.beginPath();
            ctx.moveTo(node.x, node.y);
            ctx.lineTo(parentNode.x, parentNode.y);
            ctx.strokeStyle = isLight ? 'rgba(0, 0, 0, 0.22)' : 'rgba(255, 255, 255, 0.25)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 4]);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
      });

      // Draw Nodes
      graphNodes.forEach((node) => {
        let nodeColor = isLight ? '#64748b' : '#a1a1aa';
        if (node.task.status === 'IN_PROGRESS') nodeColor = '#f59e0b';
        if (node.task.status === 'DONE') nodeColor = '#10b981';

        const isFocused = focusedTaskId === node.task.id || inspectorSelectedTaskId === node.task.id;
        const childCount = currentTasks.filter((t) => t.parentId === node.task.id).length;

        const baseRadius = 9;
        const coreRadius = baseRadius + Math.min(childCount * 4, 16);
        const haloRadius = coreRadius + (isFocused ? 10 : 6);

        // Halo
        ctx.beginPath();
        ctx.arc(node.x, node.y, haloRadius, 0, Math.PI * 2);
        ctx.fillStyle = nodeColor;
        ctx.globalAlpha = isFocused ? 0.35 : 0.15;
        ctx.fill();

        // Core Circle
        ctx.beginPath();
        ctx.arc(node.x, node.y, coreRadius, 0, Math.PI * 2);
        ctx.globalAlpha = 1.0;
        ctx.fillStyle = nodeColor;
        ctx.fill();

        if (isFocused) {
          ctx.strokeStyle = isLight ? '#18181b' : '#ffffff';
          ctx.lineWidth = 2.5;
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

        // Label
        ctx.font = isFocused ? 'bold 12px Inter, sans-serif' : '11px Inter, sans-serif';
        ctx.fillStyle = isLight ? '#18181b' : '#f4f4f5';
        ctx.textAlign = 'center';
        ctx.fillText(node.task.title, node.x, node.y + haloRadius + 14);
      });

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
        if (task.status !== btnStatus) {
          updateTaskStatus(task.id, btnStatus);
        }
      };
    });

    if (btnInspectorElevate) {
      btnInspectorElevate.disabled = !task.parentId;
      btnInspectorElevate.style.opacity = task.parentId ? '1' : '0.4';
      btnInspectorElevate.onclick = (e) => {
        e.stopPropagation();
        if (task.parentId) {
          changeTaskParent(task.id, null);
        }
      };
    }

    if (btnInspectorDelete) {
      btnInspectorDelete.onclick = (e) => {
        e.stopPropagation();
        if (confirm(`タスク「${task.title}」を削除しますか？`)) {
          deleteTask(task.id);
          closeObsidianNodeInspector();
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
        <th class="gantt-bar-cell">時系列タイムライン & 予定マーカー (🚩)</th>
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
      taskTd.innerHTML = `<span class="gantt-tree-indent">${indentStr}</span>${task.title}`;

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

      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(e.key)) {
        return;
      }

      if (confirmModal && !confirmModal.classList.contains('hidden')) {
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

  // Socket Emitters
  function updateTaskStatus(taskId, newStatus) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          action: 'UPDATE_STATUS',
          taskId,
          status: newStatus,
          // Note: preserve existing orderIndex by omitting newOrderIndex
        })
      );
    }
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
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          action: 'DELETE_TASK',
          taskId,
        })
      );
    }
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
