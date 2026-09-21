(function () {
  let socket = null;
  let currentTasks = [];
  let draggedTaskId = null;
  let focusedTaskId = null;

  // View Modes: 'TREE_VIEW' | 'OBSIDIAN_GRAPH_VIEW' | 'KANBAN_VIEW'
  let currentViewMode = 'TREE_VIEW';
  let userPreferredViewMode = 'TREE_VIEW';

  // Idle Timer & Screensaver Mode
  let idleTimer = null;
  const IDLE_TIMEOUT_MS = 4000; // 4 seconds idle auto transition
  let isScreensaverActive = false;

  // Canvas Animation Frames & State
  let canvasAnimationId = null;
  let bgCanvasAnimationId = null;
  let graphNodes = [];
  let draggedGraphNode = null;
  let dragStartPos = { x: 0, y: 0 };

  // DOM Elements
  const appContainer = document.querySelector('.app-container');
  const nodeDisplay = document.getElementById('node-id-display');
  const errorToast = document.getElementById('error-toast');

  const btnViewTree = document.getElementById('btn-view-tree');
  const btnViewGraph = document.getElementById('btn-view-graph');
  const btnViewKanban = document.getElementById('btn-view-kanban');

  const quickForm = document.getElementById('quick-task-form');
  const quickInputTitle = document.getElementById('quick-title-input');
  const selectQuickParent = document.getElementById('select-quick-parent');

  const pureTreeViewSection = document.getElementById('pure-tree-view');
  const pureTreeContainer = document.getElementById('pure-tree-container');

  const obsidianGraphViewSection = document.getElementById('obsidian-graph-view');
  const canvas = document.getElementById('obsidian-canvas');
  const bgCanvas = document.getElementById('bg-obsidian-canvas');
  const screensaverOverlay = document.getElementById('screensaver-overlay');

  const kanbanViewSection = document.getElementById('kanban-view');
  const listTodo = document.getElementById('list-todo');
  const listInProgress = document.getElementById('list-in-progress');
  const listDone = document.getElementById('list-done');

  const countTodo = document.getElementById('count-todo');
  const countInProgress = document.getElementById('count-in-progress');
  const countDone = document.getElementById('count-done');

  const columns = document.querySelectorAll('.kanban-column');

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
          updateParentTaskOptions();
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
    selectQuickParent.innerHTML = '<option value="">📁 ルートタスク</option>';
    currentTasks.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = `📁 ${t.title}`;
      selectQuickParent.appendChild(opt);
    });
  }

  // 3-Mode View Buttons Setup
  btnViewTree.addEventListener('click', () => setViewMode('TREE_VIEW', true));
  btnViewGraph.addEventListener('click', () => setViewMode('OBSIDIAN_GRAPH_VIEW', true));
  btnViewKanban.addEventListener('click', () => setViewMode('KANBAN_VIEW', true));

  function setViewMode(mode, isUserAction = false) {
    if (isUserAction) {
      userPreferredViewMode = mode;
      exitScreensaver();
    }
    currentViewMode = mode;

    btnViewTree.classList.toggle('active', mode === 'TREE_VIEW');
    btnViewGraph.classList.toggle('active', mode === 'OBSIDIAN_GRAPH_VIEW');
    btnViewKanban.classList.toggle('active', mode === 'KANBAN_VIEW');

    pureTreeViewSection.classList.toggle('hidden', mode !== 'TREE_VIEW');
    obsidianGraphViewSection.classList.toggle('hidden', mode !== 'OBSIDIAN_GRAPH_VIEW');
    kanbanViewSection.classList.toggle('hidden', mode !== 'KANBAN_VIEW');

    renderCurrentView();
  }

  function renderCurrentView() {
    if (canvasAnimationId) {
      cancelAnimationFrame(canvasAnimationId);
      canvasAnimationId = null;
    }

    if (currentViewMode === 'TREE_VIEW') {
      renderPureTreeView();
    } else if (currentViewMode === 'OBSIDIAN_GRAPH_VIEW') {
      startObsidianGraphRenderer(canvas, false);
    } else if (currentViewMode === 'KANBAN_VIEW') {
      renderKanbanView();
    }
  }

  // VIEW 1: Pure Tree View (Single-Canvas, No 3-Column Split)
  function renderPureTreeView() {
    pureTreeContainer.innerHTML = '';
    const rootTasks = currentTasks.filter((t) => !t.parentId).sort((a, b) => a.orderIndex - b.orderIndex);

    rootTasks.forEach((rootTask) => {
      const nodeEl = renderTaskTreeNode(rootTask);
      pureTreeContainer.appendChild(nodeEl);
    });

    if (focusedTaskId) {
      highlightFocusedTaskCard(focusedTaskId);
    }
  }

  function renderTaskTreeNode(task) {
    const nodeWrapper = document.createElement('div');
    nodeWrapper.className = `task-tree-node ${task.parentId ? 'is-subtask' : ''}`;

    const card = createTaskCard(task);
    nodeWrapper.appendChild(card);

    const children = currentTasks.filter((t) => t.parentId === task.id).sort((a, b) => a.orderIndex - b.orderIndex);
    if (children.length > 0 && !task.isCollapsed) {
      const childrenContainer = document.createElement('div');
      childrenContainer.className = 'tree-children-container';
      childrenContainer.style.display = 'flex';
      childrenContainer.style.flexDirection = 'column';
      childrenContainer.style.gap = '0.75rem';
      childrenContainer.style.marginTop = '0.5rem';

      children.forEach((childTask) => {
        childrenContainer.appendChild(renderTaskTreeNode(childTask));
      });

      nodeWrapper.appendChild(childrenContainer);
    }

    return nodeWrapper;
  }

  // VIEW 2 & Screensaver: Obsidian Interactive Graph Canvas Renderer (Physics Drag & Click)
  function startObsidianGraphRenderer(targetCanvas, isBgScreensaver = false) {
    if (!targetCanvas) return;
    const ctx = targetCanvas.getContext('2d');
    if (!ctx) return;

    targetCanvas.width = isBgScreensaver ? window.innerWidth : targetCanvas.parentElement.clientWidth;
    targetCanvas.height = isBgScreensaver ? window.innerHeight : targetCanvas.parentElement.clientHeight;

    // Build Node Physics Array
    graphNodes = currentTasks.map((task, idx) => {
      const angle = (idx / Math.max(1, currentTasks.length)) * Math.PI * 2;
      const radius = Math.min(targetCanvas.width, targetCanvas.height) * 0.3;
      const centerX = targetCanvas.width / 2;
      const centerY = targetCanvas.height / 2;

      return {
        task,
        x: task.parentId ? centerX + Math.cos(angle) * radius * 0.8 : centerX + Math.cos(angle) * (radius * 0.5),
        y: task.parentId ? centerY + Math.sin(angle) * radius * 0.8 : centerY + Math.sin(angle) * (radius * 0.5),
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        isPinned: false,
      };
    });

    const nodeMap = new Map(graphNodes.map((n) => [n.task.id, n]));

    function animate() {
      ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);

      // Draw Connection Edges (Glowing Lines between Parent & Child)
      graphNodes.forEach((node) => {
        if (node.task.parentId) {
          const parentNode = nodeMap.get(node.task.parentId);
          if (parentNode) {
            ctx.beginPath();
            ctx.moveTo(node.x, node.y);
            ctx.lineTo(parentNode.x, parentNode.y);

            const gradient = ctx.createLinearGradient(node.x, node.y, parentNode.x, parentNode.y);
            gradient.addColorStop(0, 'rgba(129, 140, 248, 0.65)');
            gradient.addColorStop(1, 'rgba(56, 189, 248, 0.65)');

            ctx.strokeStyle = gradient;
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
      });

      // Draw Nodes & Physics Motion
      graphNodes.forEach((node) => {
        if (!node.isPinned) {
          node.x += node.vx;
          node.y += node.vy;

          if (node.x < 40 || node.x > targetCanvas.width - 40) node.vx *= -1;
          if (node.y < 40 || node.y > targetCanvas.height - 40) node.vy *= -1;
        }

        let nodeColor = '#38bdf8'; // TODO: Blue
        if (node.task.status === 'IN_PROGRESS') nodeColor = '#fbbf24'; // Amber
        if (node.task.status === 'DONE') nodeColor = '#34d399'; // Green

        // Glowing halo
        ctx.beginPath();
        ctx.arc(node.x, node.y, focusedTaskId === node.task.id ? 22 : 16, 0, Math.PI * 2);
        ctx.fillStyle = nodeColor;
        ctx.globalAlpha = focusedTaskId === node.task.id ? 0.45 : 0.25;
        ctx.fill();

        // Core Circle
        ctx.beginPath();
        ctx.arc(node.x, node.y, 8, 0, Math.PI * 2);
        ctx.globalAlpha = 1.0;
        ctx.fillStyle = nodeColor;
        ctx.shadowColor = nodeColor;
        ctx.shadowBlur = focusedTaskId === node.task.id ? 20 : 12;
        ctx.fill();
        ctx.shadowBlur = 0;

        // Label
        ctx.font = '12px Inter, sans-serif';
        ctx.fillStyle = '#f8fafc';
        ctx.textAlign = 'center';
        ctx.fillText(node.task.title, node.x, node.y + 24);
      });

      if (isBgScreensaver) {
        bgCanvasAnimationId = requestAnimationFrame(animate);
      } else {
        canvasAnimationId = requestAnimationFrame(animate);
      }
    }

    animate();
    setupCanvasInteractivity(targetCanvas);
  }

  // Canvas Mouse Dragging & Click Selection Handler
  function setupCanvasInteractivity(targetCanvas) {
    let isMouseDown = false;
    let clickStartX = 0;
    let clickStartY = 0;

    targetCanvas.onmousedown = (e) => {
      const rect = targetCanvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      clickStartX = e.clientX;
      clickStartY = e.clientY;

      const hitNode = graphNodes.find((n) => Math.hypot(n.x - mouseX, n.y - mouseY) <= 24);
      if (hitNode) {
        isMouseDown = true;
        draggedGraphNode = hitNode;
        hitNode.isPinned = true;
      }
    };

    targetCanvas.onmousemove = (e) => {
      if (isMouseDown && draggedGraphNode) {
        const rect = targetCanvas.getBoundingClientRect();
        draggedGraphNode.x = e.clientX - rect.left;
        draggedGraphNode.y = e.clientY - rect.top;
      }
    };

    targetCanvas.onmouseup = (e) => {
      const dist = Math.hypot(e.clientX - clickStartX, e.clientY - clickStartY);
      if (draggedGraphNode) {
        draggedGraphNode.isPinned = false;
        if (dist < 5) {
          // Clicked on a Node: Focus task & switch to editing view!
          const taskId = draggedGraphNode.task.id;
          exitScreensaver();
          setViewMode(userPreferredViewMode === 'OBSIDIAN_GRAPH_VIEW' ? 'TREE_VIEW' : userPreferredViewMode, true);
          setFocusedTask(taskId);
        }
      }
      isMouseDown = false;
      draggedGraphNode = null;
    };
  }

  // VIEW 3: 3-Column Kanban View
  function renderKanbanView() {
    listTodo.innerHTML = '';
    listInProgress.innerHTML = '';
    listDone.innerHTML = '';

    let todoCount = 0;
    let inProgressCount = 0;
    let doneCount = 0;

    currentTasks.forEach((t) => {
      if (t.status === 'TODO') todoCount++;
      if (t.status === 'IN_PROGRESS') inProgressCount++;
      if (t.status === 'DONE') doneCount++;
    });

    countTodo.textContent = todoCount;
    countInProgress.textContent = inProgressCount;
    countDone.textContent = doneCount;

    const sortedTasks = [...currentTasks].sort((a, b) => a.orderIndex - b.orderIndex);
    sortedTasks.forEach((task) => {
      const card = createTaskCard(task);
      if (task.status === 'TODO') listTodo.appendChild(card);
      else if (task.status === 'IN_PROGRESS') listInProgress.appendChild(card);
      else if (task.status === 'DONE') listDone.appendChild(card);
    });

    if (focusedTaskId) {
      highlightFocusedTaskCard(focusedTaskId);
    }
  }

  // Create Task Card Element
  function createTaskCard(task) {
    const item = document.createElement('div');
    item.className = `task-item ${focusedTaskId === task.id ? 'focused' : ''}`;
    item.setAttribute('draggable', 'true');
    item.dataset.taskId = task.id;

    item.addEventListener('click', (e) => {
      e.stopPropagation();
      setFocusedTask(task.id);
    });

    item.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      draggedTaskId = task.id;
      item.classList.add('dragging');
      e.dataTransfer.setData('text/plain', task.id);
    });

    item.addEventListener('dragend', (e) => {
      e.stopPropagation();
      draggedTaskId = null;
      item.classList.remove('dragging');
      document.querySelectorAll('.drop-target-parent').forEach((el) => el.classList.remove('drop-target-parent'));
    });

    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (draggedTaskId && draggedTaskId !== task.id) {
        item.classList.add('drop-target-parent');
      }
    });

    item.addEventListener('dragleave', (e) => {
      e.stopPropagation();
      item.classList.remove('drop-target-parent');
    });

    item.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      item.classList.remove('drop-target-parent');
      const sourceTaskId = e.dataTransfer.getData('text/plain') || draggedTaskId;

      if (sourceTaskId && sourceTaskId !== task.id) {
        changeTaskParent(sourceTaskId, task.id);
      }
    });

    // Card Top (Title + Toggle + Delete)
    const top = document.createElement('div');
    top.className = 'task-top';

    const titleGroup = document.createElement('div');
    titleGroup.className = 'task-title-group';

    const children = currentTasks.filter((t) => t.parentId === task.id);
    const isParent = children.length > 0;

    if (isParent && currentViewMode === 'TREE_VIEW') {
      const btnToggle = document.createElement('button');
      btnToggle.className = 'btn-toggle-tree';
      btnToggle.textContent = task.isCollapsed ? '▶' : '▼';
      btnToggle.title = task.isCollapsed ? '子タスクを展開' : '子タスクを折りたたむ';
      btnToggle.onclick = (e) => {
        e.stopPropagation();
        toggleTaskCollapse(task.id, !task.isCollapsed);
      };
      titleGroup.appendChild(btnToggle);
    }

    const titleEl = document.createElement('div');
    titleEl.className = 'task-title';
    titleEl.textContent = task.title;
    titleGroup.appendChild(titleEl);

    const btnDelete = document.createElement('button');
    btnDelete.className = 'btn-delete';
    btnDelete.innerHTML = '🗑️';
    btnDelete.title = 'タスクを削除';
    btnDelete.onclick = (e) => {
      e.stopPropagation();
      if (confirm(`タスク「${task.title}」を削除しますか？`)) {
        deleteTask(task.id);
      }
    };

    top.appendChild(titleGroup);
    top.appendChild(btnDelete);
    item.appendChild(top);

    // Parent Task Progress Bar & Calculation
    let percentage = 0;
    if (isParent) {
      const completedCount = children.filter((c) => c.status === 'DONE').length;
      percentage = Math.round((completedCount / children.length) * 100);

      const progressBox = document.createElement('div');
      progressBox.className = 'parent-progress-box';

      const labelRow = document.createElement('div');
      labelRow.className = 'progress-label-row';
      labelRow.innerHTML = `<span>進捗率</span><span>${completedCount}/${children.length} 完了 (${percentage}%)</span>`;

      const track = document.createElement('div');
      track.className = 'progress-bar-track';

      const fill = document.createElement('div');
      fill.className = 'progress-bar-fill';
      fill.style.width = `${percentage}%`;

      track.appendChild(fill);
      progressBox.appendChild(labelRow);
      progressBox.appendChild(track);
      item.appendChild(progressBox);
    }

    // Footer with Status Controls: Read-only Lock for Parents, Interactive Buttons for Leaf Tasks
    const footer = document.createElement('div');
    footer.className = 'task-footer';

    if (isParent) {
      // Parent Node Status Lock
      const lockBadge = document.createElement('div');
      lockBadge.className = 'status-locked-badge';
      lockBadge.innerHTML = `🔒 自動算出: ${percentage}%`;
      footer.appendChild(lockBadge);
    } else {
      // Leaf Node All-Level Status Buttons
      const statusGroup = document.createElement('div');
      statusGroup.className = 'status-btn-group';

      const statuses = [
        { key: 'TODO', label: 'TODO' },
        { key: 'IN_PROGRESS', label: 'PROGRESS' },
        { key: 'DONE', label: 'DONE' },
      ];

      statuses.forEach((s) => {
        const btn = document.createElement('button');
        btn.className = `status-btn ${task.status === s.key ? `active-${s.key}` : ''}`;
        btn.textContent = s.label;
        btn.onclick = (e) => {
          e.stopPropagation();
          if (task.status !== s.key) {
            updateTaskStatus(task.id, s.key);
          }
        };
        statusGroup.appendChild(btn);
      });

      footer.appendChild(statusGroup);
    }

    const authorSpan = document.createElement('span');
    authorSpan.textContent = `By: ${task.authorNodeId || 'local'}`;
    footer.appendChild(authorSpan);

    item.appendChild(footer);
    return item;
  }

  function setFocusedTask(taskId) {
    focusedTaskId = taskId;
    highlightFocusedTaskCard(taskId);
  }

  function highlightFocusedTaskCard(taskId) {
    document.querySelectorAll('.task-item').forEach((el) => {
      if (el.dataset.taskId === taskId) {
        el.classList.add('focused');
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else {
        el.classList.remove('focused');
      }
    });
  }

  // Setup Drag & Drop for Kanban Columns
  function setupDragAndDrop() {
    columns.forEach((col) => {
      col.addEventListener('dragover', (e) => {
        e.preventDefault();
        col.classList.add('drag-over');
      });

      col.addEventListener('dragleave', () => {
        col.classList.remove('drag-over');
      });

      col.addEventListener('drop', (e) => {
        e.preventDefault();
        col.classList.remove('drag-over');
        const targetStatus = col.dataset.status;
        const taskId = e.dataTransfer.getData('text/plain') || draggedTaskId;

        if (taskId && targetStatus) {
          updateTaskStatus(taskId, targetStatus);
        }
      });
    });
  }

  // Setup Keyboard Navigation
  function setupKeyboardNavigation() {
    window.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
        return;
      }

      if (!currentTasks || currentTasks.length === 0) return;

      if (!focusedTaskId) {
        focusedTaskId = currentTasks[0].id;
        renderCurrentView();
        return;
      }

      const currentIndex = currentTasks.findIndex((t) => t.id === focusedTaskId);
      if (currentIndex === -1) return;

      const currentTask = currentTasks[currentIndex];

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prevIndex = (currentIndex - 1 + currentTasks.length) % currentTasks.length;
        setFocusedTask(currentTasks[prevIndex].id);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const nextIndex = (currentIndex + 1) % currentTasks.length;
        setFocusedTask(currentTasks[nextIndex].id);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (currentTask.status === 'TODO') updateTaskStatus(currentTask.id, 'IN_PROGRESS');
        else if (currentTask.status === 'IN_PROGRESS') updateTaskStatus(currentTask.id, 'DONE');
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (currentTask.status === 'DONE') updateTaskStatus(currentTask.id, 'IN_PROGRESS');
        else if (currentTask.status === 'IN_PROGRESS') updateTaskStatus(currentTask.id, 'TODO');
      }
    });
  }

  // Idle Timer Setup (4 Seconds Auto Transition to Background Screensaver Mode)
  function setupIdleTimer() {
    function resetIdleTimer() {
      if (idleTimer) clearTimeout(idleTimer);

      idleTimer = setTimeout(() => {
        enterScreensaver();
      }, IDLE_TIMEOUT_MS);
    }

    // Reset idle timer on keyboard activity
    window.addEventListener('keydown', () => {
      if (isScreensaverActive) {
        exitScreensaver();
      }
      resetIdleTimer();
    });

    // Reset idle timer on window click (Click Return)
    window.addEventListener('click', (e) => {
      if (isScreensaverActive) {
        exitScreensaver();
      } else {
        resetIdleTimer();
      }
    });

    screensaverOverlay.addEventListener('click', () => {
      exitScreensaver();
    });

    resetIdleTimer();
  }

  function enterScreensaver() {
    if (isScreensaverActive) return;
    isScreensaverActive = true;

    bgCanvas.classList.remove('hidden');
    screensaverOverlay.classList.remove('hidden');
    appContainer.classList.add('screensaver-fade');

    startObsidianGraphRenderer(bgCanvas, true);
  }

  function exitScreensaver() {
    if (!isScreensaverActive) return;
    isScreensaverActive = false;

    if (bgCanvasAnimationId) {
      cancelAnimationFrame(bgCanvasAnimationId);
      bgCanvasAnimationId = null;
    }

    bgCanvas.classList.add('hidden');
    screensaverOverlay.classList.add('hidden');
    appContainer.classList.remove('screensaver-fade');

    renderCurrentView();
  }

  // Socket Emitters
  function updateTaskStatus(taskId, newStatus) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          action: 'UPDATE_STATUS',
          taskId,
          status: newStatus,
          newOrderIndex: Date.now(),
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

  function toggleTaskCollapse(taskId, isCollapsed) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          action: 'TOGGLE_COLLAPSE',
          taskId,
          isCollapsed,
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
    const parentId = selectQuickParent.value || null;
    if (title) {
      sendCreateTask(title, parentId);
      quickInputTitle.value = '';
    }
  });

  setupDragAndDrop();
  setupKeyboardNavigation();
  setupIdleTimer();
  initWebSocket();
})();
