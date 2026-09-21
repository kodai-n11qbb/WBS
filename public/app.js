(function () {
  let socket = null;
  let currentTasks = [];
  let draggedTaskId = null;
  let focusedTaskId = null;

  // View Modes: 'TREE_VIEW' | 'OBSIDIAN_GRAPH_VIEW' | 'KANBAN_VIEW'
  let currentViewMode = 'TREE_VIEW';
  let userPreferredViewMode = 'TREE_VIEW';

  // Canvas Animation Frame & Physics State
  let canvasAnimationId = null;
  let graphNodes = [];
  let draggedGraphNode = null;
  let pendingParentingAction = null; // { childTaskId, parentTaskId }

  // DOM Elements
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

  const confirmModal = document.getElementById('confirm-parent-modal');
  const confirmModalText = document.getElementById('confirm-modal-text');
  const btnModalCancel = document.getElementById('btn-modal-cancel');
  const btnModalConfirm = document.getElementById('btn-modal-confirm');

  const kanbanViewSection = document.getElementById('kanban-view');
  const listTodo = document.getElementById('list-todo');
  const listInProgress = document.getElementById('list-in-progress');
  const listDone = document.getElementById('list-done');

  const countTodo = document.getElementById('count-todo');
  const countInProgress = document.getElementById('count-in-progress');
  const countDone = document.getElementById('count-done');

  const columns = document.querySelectorAll('.kanban-column');

  const floatingInboxContainer = document.getElementById('floating-inbox-container');
  const floatingInboxDrawer = document.getElementById('floating-inbox-drawer');
  const btnToggleInbox = document.getElementById('btn-toggle-inbox');
  const btnCloseInbox = document.getElementById('btn-close-inbox');
  const floatingInboxBadge = document.getElementById('floating-inbox-badge');
  const floatingInboxList = document.getElementById('floating-inbox-list');

  if (btnToggleInbox && floatingInboxDrawer) {
    btnToggleInbox.addEventListener('click', () => {
      floatingInboxDrawer.classList.toggle('hidden');
    });
  }
  if (btnCloseInbox && floatingInboxDrawer) {
    btnCloseInbox.addEventListener('click', () => {
      floatingInboxDrawer.classList.add('hidden');
    });
  }

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
    selectQuickParent.innerHTML = '';

    const rootOpt = document.createElement('option');
    rootOpt.value = '';
    rootOpt.textContent = '📁 ルートタスク (親指定なし)';
    selectQuickParent.appendChild(rootOpt);

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
    }
    currentViewMode = mode;

    btnViewTree.classList.toggle('active', mode === 'TREE_VIEW');
    btnViewGraph.classList.toggle('active', mode === 'OBSIDIAN_GRAPH_VIEW');
    btnViewKanban.classList.toggle('active', mode === 'KANBAN_VIEW');

    pureTreeViewSection.classList.toggle('hidden', mode !== 'TREE_VIEW');
    obsidianGraphViewSection.classList.toggle('hidden', mode !== 'OBSIDIAN_GRAPH_VIEW');
    kanbanViewSection.classList.toggle('hidden', mode !== 'KANBAN_VIEW');

    if (floatingUnclassifiedLayer) {
      floatingUnclassifiedLayer.classList.toggle('hidden', mode !== 'TREE_VIEW');
    }

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
      startObsidianGraphRenderer();
    } else if (currentViewMode === 'KANBAN_VIEW') {
      renderKanbanView();
    }
  }

  // VIEW 1: Pure Tree View (Single-Canvas with Screen-Floating Standalone Root Tasks)
  function renderPureTreeView() {
    pureTreeContainer.innerHTML = '';
    if (floatingUnclassifiedLayer) floatingUnclassifiedLayer.innerHTML = '';

    const hasSubtasks = (t) => currentTasks.some((child) => child.parentId === t.id);

    // 1. Render Floating Standalone Root Tasks (root tasks with no children)
    const floatingTasks = currentTasks.filter((t) => !t.parentId && !hasSubtasks(t))
      .sort((a, b) => a.orderIndex - b.orderIndex);

    if (floatingUnclassifiedLayer) {
      floatingTasks.forEach((task, idx) => {
        const floatingCard = document.createElement('div');
        floatingCard.className = `floating-unclassified-card ${focusedTaskId === task.id ? 'focused' : ''}`;
        floatingCard.setAttribute('draggable', 'true');
        floatingCard.dataset.taskId = task.id;

        // Position staggered across screen canvas
        const posX = 40 + (idx * 230) % (Math.max(800, window.innerWidth - 300));
        const posY = 150 + Math.floor((idx * 230) / Math.max(800, window.innerWidth - 300)) * 75;

        floatingCard.style.left = `${posX}px`;
        floatingCard.style.top = `${posY}px`;
        floatingCard.style.animationDelay = `${(idx * 0.8) % 4}s`;

        const dot = document.createElement('span');
        dot.className = 'floating-card-dot';

        const titleSpan = document.createElement('span');
        titleSpan.className = 'floating-card-title';
        titleSpan.textContent = task.title;

        floatingCard.appendChild(dot);
        floatingCard.appendChild(titleSpan);

        floatingCard.addEventListener('click', (e) => {
          e.stopPropagation();
          setFocusedTask(task.id);
        });

        floatingCard.addEventListener('dragstart', (e) => {
          e.stopPropagation();
          draggedTaskId = task.id;
          floatingCard.classList.add('dragging');
          e.dataTransfer.setData('text/plain', task.id);
        });

        floatingCard.addEventListener('dragend', (e) => {
          e.stopPropagation();
          draggedTaskId = null;
          floatingCard.classList.remove('dragging');
          document.querySelectorAll('.drop-target-parent').forEach((el) => el.classList.remove('drop-target-parent'));
        });

        floatingUnclassifiedLayer.appendChild(floatingCard);
      });
    }

    // 2. Render Main Parent Tree Tasks in Canvas (root tasks with children)
    const rootTreeTasks = currentTasks.filter((t) => !t.parentId && hasSubtasks(t))
      .sort((a, b) => a.orderIndex - b.orderIndex);

    if (rootTreeTasks.length === 0) {
      const emptyTreeMsg = document.createElement('div');
      emptyTreeMsg.className = 'empty-tree-notice';
      emptyTreeMsg.style.cssText = 'font-size: 0.9rem; color: var(--text-secondary); text-align: center; padding: 3rem 1rem; border: 1px dashed var(--card-border); border-radius: var(--radius-md); margin-top: 1rem;';
      emptyTreeMsg.textContent = '構造化されたルートタスクがまだありません。画面上の浮遊タスクを各親タスクへドラッグ＆ドロップして分類してください。';
      pureTreeContainer.appendChild(emptyTreeMsg);
    } else {
      rootTreeTasks.forEach((rootTask) => {
        const nodeEl = renderTaskTreeNode(rootTask);
        pureTreeContainer.appendChild(nodeEl);
      });
    }

    if (focusedTaskId) {
      highlightFocusedTaskCard(focusedTaskId);
    }
  }

  function renderTaskTreeNode(task) {
    const isUnclassified = !task.parentId && (task.title.includes('未分類') || task.title.toLowerCase().includes('tmp'));
    const nodeWrapper = document.createElement('div');
    nodeWrapper.className = `task-tree-node ${task.parentId ? 'is-subtask' : ''} ${isUnclassified ? 'is-unclassified-container' : ''}`;

    if (isUnclassified) {
      const inboxHeader = document.createElement('div');
      inboxHeader.className = 'inbox-section-banner';
      inboxHeader.innerHTML = `<span>[ 未分類インボックス ] ドラッグ＆ドロップで各親タスクへ分類可能</span>`;
      nodeWrapper.appendChild(inboxHeader);
    }

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

  // VIEW 2: Obsidian Graph Canvas Renderer with Spring Physics & Node Dragging
  function startObsidianGraphRenderer() {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const wrapper = canvas.parentElement;
    canvas.width = wrapper.clientWidth;
    canvas.height = wrapper.clientHeight;

    // Initialize or Sync Node Array
    const existingNodeMap = new Map(graphNodes.map((n) => [n.task.id, n]));

    graphNodes = currentTasks.map((task, idx) => {
      const existing = existingNodeMap.get(task.id);
      if (existing) {
        existing.task = task;
        return existing;
      }

      const angle = (idx / Math.max(1, currentTasks.length)) * Math.PI * 2;
      const radius = Math.min(canvas.width, canvas.height) * 0.3;
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;

      return {
        task,
        x: task.parentId ? centerX + Math.cos(angle) * radius * 0.8 : centerX + Math.cos(angle) * (radius * 0.5),
        y: task.parentId ? centerY + Math.sin(angle) * radius * 0.8 : centerY + Math.sin(angle) * (radius * 0.5),
        vx: (Math.random() - 0.5) * 0.2,
        vy: (Math.random() - 0.5) * 0.2,
        isPinned: false,
      };
    });

    const nodeMap = new Map(graphNodes.map((n) => [n.task.id, n]));

    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // 1. Calculate Spring Physics Elasticity & Repulsion (Overlap Prevention)
      // (A) Spring Attraction between Parent & Child Nodes
      graphNodes.forEach((node) => {
        if (node.task.parentId) {
          const parentNode = nodeMap.get(node.task.parentId);
          if (parentNode) {
            const dx = node.x - parentNode.x;
            const dy = node.y - parentNode.y;
            const dist = Math.hypot(dx, dy) || 1;
            const restLength = 130; // Natural spring distance
            const stiffness = 0.04; // Spring elasticity
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

      // (B) Node-to-Node Repulsion Physics (Bypassed for actively dragged nodes)
      const minRepelDist = 130;
      for (let i = 0; i < graphNodes.length; i++) {
        for (let j = i + 1; j < graphNodes.length; j++) {
          const nodeA = graphNodes[i];
          const nodeB = graphNodes[j];

          // If a node is currently grabbed by mouse, disable repulsion so it can overlap smoothly
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

            // Hard Separation Boundary (70px limit when idle)
            if (dist < 70) {
              const push = (70 - dist) / 2;
              const px = (dx / dist) * push;
              const py = (dy / dist) * push;
              nodeA.x -= px; nodeA.y -= py;
              nodeB.x += px; nodeB.y += py;
            }
          }
        }
      }

      // (C) Ambient Floating Motion (Gentle Floating/Drifting Effect), Damping & Border Constraints
      const nowTime = Date.now() * 0.0012;
      graphNodes.forEach((node, idx) => {
        if (!node.isPinned) {
          // Gentle ambient floating wave forces
          const driftX = Math.cos(nowTime * 0.8 + idx * 1.5) * 0.06;
          const driftY = Math.sin(nowTime * 0.7 + idx * 2.1) * 0.06;

          node.vx += driftX;
          node.vy += driftY;

          // Smooth Damping for continuous floating motion
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

      // 2. Draw Connection Edges (Glowing Lines)
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

      // 3. Draw Nodes (Dynamically Scaled by Child Task Count)
      graphNodes.forEach((node) => {
        let nodeColor = '#38bdf8'; // TODO: Blue
        if (node.task.status === 'IN_PROGRESS') nodeColor = '#fbbf24'; // Amber
        if (node.task.status === 'DONE') nodeColor = '#34d399'; // Green

        const isFocused = focusedTaskId === node.task.id;
        const childCount = currentTasks.filter((t) => t.parentId === node.task.id).length;

        // Dynamic Sizing based on subtask count
        const baseRadius = 8;
        const coreRadius = baseRadius + Math.min(childCount * 4, 18); // Core radius scales from 8px to 26px
        const haloRadius = coreRadius + (isFocused ? 12 : 8); // Glowing halo scales proportionally

        // Glowing halo
        ctx.beginPath();
        ctx.arc(node.x, node.y, haloRadius, 0, Math.PI * 2);
        ctx.fillStyle = nodeColor;
        ctx.globalAlpha = isFocused ? 0.45 : 0.22;
        ctx.fill();

        // Core Circle
        ctx.beginPath();
        ctx.arc(node.x, node.y, coreRadius, 0, Math.PI * 2);
        ctx.globalAlpha = 1.0;
        ctx.fillStyle = nodeColor;
        ctx.shadowColor = nodeColor;
        ctx.shadowBlur = isFocused ? 22 : 12;
        ctx.fill();
        ctx.shadowBlur = 0;

        // Badge indicating child count for major hubs
        if (childCount > 0) {
          ctx.font = 'bold 10px Inter, sans-serif';
          ctx.fillStyle = '#0f172a';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`${childCount}`, node.x, node.y);
          ctx.textBaseline = 'alphabetic'; // Reset
        }

        // Label
        ctx.font = childCount > 0 ? 'bold 12px Inter, sans-serif' : '12px Inter, sans-serif';
        ctx.fillStyle = '#f8fafc';
        ctx.textAlign = 'center';
        ctx.fillText(node.task.title, node.x, node.y + haloRadius + 14);
      });

      canvasAnimationId = requestAnimationFrame(animate);
    }

    animate();
    setupCanvasInteractivity();
  }

  // Cycle Prevention Helper Function
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

  // Canvas Mouse Dragging, Node Focus & Parent Drag-Drop Confirmation
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

        if (dist < 5) {
          // Clicked Node: Focus task & switch to tree/kanban view
          const taskId = draggedGraphNode.task.id;
          setViewMode(userPreferredViewMode === 'OBSIDIAN_GRAPH_VIEW' ? 'TREE_VIEW' : userPreferredViewMode, true);
          setFocusedTask(taskId);
        } else {
          // Dragged Node: Check if dropped onto another node (Threshold 45px)
          const targetNode = graphNodes.find(
            (n) => n.task.id !== draggedGraphNode.task.id && Math.hypot(n.x - draggedGraphNode.x, n.y - draggedGraphNode.y) <= 45
          );

          if (targetNode) {
            if (isDescendantOf(targetNode.task.id, draggedGraphNode.task.id)) {
              showErrorToast('⚠️ 親タスクを自己の子孫タスクの中に移動することはできません。');
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

  // Parent Drag Confirmation Modal
  function promptParentingConfirmation(childTask, parentTask) {
    pendingParentingAction = { childTaskId: childTask.id, parentTaskId: parentTask.id };
    confirmModalText.textContent = `タスク「${childTask.title}」を「${parentTask.title}」の子タスクに変更しますか？`;
    confirmModal.classList.remove('hidden');
  }

  btnModalCancel.onclick = () => {
    confirmModal.classList.add('hidden');
    pendingParentingAction = null;
  };

  btnModalConfirm.onclick = () => {
    if (pendingParentingAction) {
      changeTaskParent(pendingParentingAction.childTaskId, pendingParentingAction.parentTaskId);
    }
    confirmModal.classList.add('hidden');
    pendingParentingAction = null;
  };

  // VIEW 3: 3-Column Kanban View (Parent Tasks Priority Sorted to Top)
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

    // Priority Sort: Parent tasks (tasks with subtasks) come FIRST, then by orderIndex
    const isParentTask = (t) => currentTasks.some((child) => child.parentId === t.id);
    const sortedTasks = [...currentTasks].sort((a, b) => {
      const aIsParent = isParentTask(a) ? 0 : 1;
      const bIsParent = isParentTask(b) ? 0 : 1;
      if (aIsParent !== bIsParent) return aIsParent - bIsParent;
      return a.orderIndex - b.orderIndex;
    });

    sortedTasks.forEach((task) => {
      const card = createTaskCard(task, true);
      if (task.status === 'TODO') listTodo.appendChild(card);
      else if (task.status === 'IN_PROGRESS') listInProgress.appendChild(card);
      else if (task.status === 'DONE') listDone.appendChild(card);
    });

    if (focusedTaskId) {
      highlightFocusedTaskCard(focusedTaskId);
    }
  }

  // Create Task Card Element
  function createTaskCard(task, isKanbanView = false) {
    const item = document.createElement('div');
    item.className = `task-item ${focusedTaskId === task.id ? 'focused' : ''} ${isKanbanView ? 'kanban-item' : ''}`;
    if (!isKanbanView) {
      item.setAttribute('draggable', 'true');
    }
    item.dataset.taskId = task.id;

    item.addEventListener('click', (e) => {
      e.stopPropagation();
      setFocusedTask(task.id);
    });

    if (!isKanbanView) {
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
        if (draggedTaskId && draggedTaskId !== task.id && !isDescendantOf(task.id, draggedTaskId)) {
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
          if (isDescendantOf(task.id, sourceTaskId)) {
            showErrorToast('⚠️ 親タスクを自己の子孫タスクの中に移動することはできません。');
            return;
          }
          changeTaskParent(sourceTaskId, task.id);
        }
      });
    }

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

    // Parent Task Progress Calculation & Background Fill
    let percentage = 0;
    if (isParent) {
      const completedCount = children.filter((c) => c.status === 'DONE').length;
      percentage = Math.round((completedCount / children.length) * 100);

      // Save vertical height by filling progress directly in card background gradient
      item.style.background = `linear-gradient(90deg, rgba(52, 211, 153, 0.22) 0%, rgba(52, 211, 153, 0.22) ${percentage}%, rgba(15, 23, 42, 0.8) ${percentage}%, rgba(15, 23, 42, 0.8) 100%)`;
      if (percentage === 100) {
        item.style.borderColor = 'rgba(52, 211, 153, 0.5)';
      }

      // Progress Badge next to Title for zero extra vertical space
      const progressBadge = document.createElement('span');
      progressBadge.className = `progress-pill-badge ${percentage === 100 ? 'done' : ''}`;
      progressBadge.textContent = `${completedCount}/${children.length} (${percentage}%)`;
      titleGroup.appendChild(progressBadge);
    }

    // Footer with Status Controls: Read-only Lock for Parents, Interactive Buttons for Leaf Tasks
    const footer = document.createElement('div');
    footer.className = 'task-footer';

    if (isParent) {
      // Parent Node Status Lock
      const lockBadge = document.createElement('div');
      lockBadge.className = 'status-locked-badge';
      lockBadge.innerHTML = `🔒 子タスク連動`;
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

    // Uncollapse any collapsed parent ancestors so target card is rendered in Tree View
    let target = currentTasks.find((t) => t.id === taskId);
    while (target && target.parentId) {
      const parentTask = currentTasks.find((t) => t.id === target.parentId);
      if (parentTask) {
        if (parentTask.isCollapsed) {
          parentTask.isCollapsed = false;
          toggleTaskCollapse(parentTask.id, false);
        }
        target = parentTask;
      } else {
        break;
      }
    }

    renderCurrentView();

    setTimeout(() => {
      highlightFocusedTaskCard(taskId);
    }, 60);
  }

  function highlightFocusedTaskCard(taskId) {
    let targetEl = null;
    document.querySelectorAll('.task-item').forEach((el) => {
      if (el.dataset.taskId === taskId) {
        el.classList.add('focused');
        targetEl = el;
      } else {
        el.classList.remove('focused');
      }
    });

    if (targetEl) {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      targetEl.classList.add('highlight-flash');
      setTimeout(() => targetEl.classList.remove('highlight-flash'), 2000);
    }
  }

  // Setup Drag & Drop for Kanban Columns & Tree Canvas Background
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

    if (pureTreeContainer) {
      pureTreeContainer.addEventListener('dragover', (e) => {
        e.preventDefault();
      });
      pureTreeContainer.addEventListener('drop', (e) => {
        if (e.target === pureTreeContainer || e.target.classList.contains('empty-tree-notice')) {
          e.preventDefault();
          const sourceTaskId = e.dataTransfer.getData('text/plain') || draggedTaskId;
          if (sourceTaskId) {
            changeTaskParent(sourceTaskId, null);
          }
        }
      });
    }
  }

  // Setup Unified Visual DOM Keyboard Navigation for Tree and Kanban Views
  function setupKeyboardNavigation() {
    window.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
        return;
      }

      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        return;
      }

      const activeSection = document.querySelector('.view-section:not(.hidden)');
      if (!activeSection) return;

      const visibleCards = Array.from(activeSection.querySelectorAll('.task-item'));
      if (visibleCards.length === 0) return;

      e.preventDefault();

      if (!focusedTaskId) {
        setFocusedTask(visibleCards[0].dataset.taskId);
        return;
      }

      const currentCardIdx = visibleCards.findIndex((el) => el.dataset.taskId === focusedTaskId);

      if (e.key === 'ArrowDown') {
        const nextIdx = currentCardIdx >= 0 && currentCardIdx < visibleCards.length - 1 ? currentCardIdx + 1 : 0;
        setFocusedTask(visibleCards[nextIdx].dataset.taskId);
      } else if (e.key === 'ArrowUp') {
        const prevIdx = currentCardIdx > 0 ? currentCardIdx - 1 : visibleCards.length - 1;
        setFocusedTask(visibleCards[prevIdx].dataset.taskId);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        if (currentViewMode === 'KANBAN_VIEW') {
          // Move horizontally between columns in Kanban view
          const currentCard = visibleCards[currentCardIdx];
          const currentColumn = currentCard ? currentCard.closest('.kanban-column') : null;
          const allCols = Array.from(document.querySelectorAll('.kanban-column'));
          const colIdx = currentColumn ? allCols.indexOf(currentColumn) : 0;

          const targetColIdx = e.key === 'ArrowRight'
            ? (colIdx + 1) % allCols.length
            : (colIdx - 1 + allCols.length) % allCols.length;

          const targetCol = allCols[targetColIdx];
          const targetCards = Array.from(targetCol.querySelectorAll('.task-item'));
          if (targetCards.length > 0) {
            setFocusedTask(targetCards[0].dataset.taskId);
          }
        } else {
          // Status change shortcut for focused task in Tree View
          const task = currentTasks.find((t) => t.id === focusedTaskId);
          if (task) {
            if (e.key === 'ArrowRight') {
              if (task.status === 'TODO') updateTaskStatus(task.id, 'IN_PROGRESS');
              else if (task.status === 'IN_PROGRESS') updateTaskStatus(task.id, 'DONE');
            } else if (e.key === 'ArrowLeft') {
              if (task.status === 'DONE') updateTaskStatus(task.id, 'IN_PROGRESS');
              else if (task.status === 'IN_PROGRESS') updateTaskStatus(task.id, 'TODO');
            }
          }
        }
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
    const selectedVal = selectQuickParent.value;

    if (!title) return;

    sendCreateTask(title, selectedVal || null);

    quickInputTitle.value = '';
  });

  setupDragAndDrop();
  setupKeyboardNavigation();
  initWebSocket();
})();
