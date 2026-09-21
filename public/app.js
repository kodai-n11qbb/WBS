(function () {
  let socket = null;
  let currentTasks = [];
  let draggedTaskId = null;
  let focusedTaskId = null;
  let currentViewMode = 'TREE_VIEW'; // 'TREE_VIEW' | 'KANBAN_VIEW'

  // DOM Elements
  const nodeDisplay = document.getElementById('node-id-display');
  const errorToast = document.getElementById('error-toast');

  const btnToggleView = document.getElementById('btn-toggle-view');
  const viewModeIcon = document.getElementById('view-mode-icon');
  const viewModeLabel = document.getElementById('view-mode-label');

  const quickForm = document.getElementById('quick-task-form');
  const quickInputTitle = document.getElementById('quick-title-input');
  const selectQuickParent = document.getElementById('select-quick-parent');

  const mainBoard = document.getElementById('main-board');
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
          renderBoard();
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
    selectQuickParent.innerHTML = '<option value="">(親タスクなし - ルート)</option>';
    currentTasks.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = `📁 ${t.title}`;
      selectQuickParent.appendChild(opt);
    });
  }

  // Toggle View Mode
  btnToggleView.addEventListener('click', () => {
    currentViewMode = currentViewMode === 'TREE_VIEW' ? 'KANBAN_VIEW' : 'TREE_VIEW';
    if (currentViewMode === 'TREE_VIEW') {
      viewModeIcon.textContent = '🌳';
      viewModeLabel.textContent = 'ツリー表示';
    } else {
      viewModeIcon.textContent = '📋';
      viewModeLabel.textContent = 'カンバン表示';
    }
    renderBoard();
  });

  // Render Board based on View Mode
  function renderBoard() {
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

    if (currentViewMode === 'TREE_VIEW') {
      // Tree-First View (Plan A)
      const rootTasks = currentTasks.filter((t) => !t.parentId).sort((a, b) => a.orderIndex - b.orderIndex);
      rootTasks.forEach((rootTask) => {
        const nodeEl = renderTaskTreeNode(rootTask);
        appendNodeToColumn(nodeEl, rootTask.status);
      });
    } else {
      // 3-Column Kanban View
      const sortedTasks = [...currentTasks].sort((a, b) => a.orderIndex - b.orderIndex);
      sortedTasks.forEach((task) => {
        const card = createTaskCard(task);
        if (task.status === 'TODO') listTodo.appendChild(card);
        else if (task.status === 'IN_PROGRESS') listInProgress.appendChild(card);
        else if (task.status === 'DONE') listDone.appendChild(card);
      });
    }

    if (focusedTaskId) {
      const el = document.querySelector(`[data-task-id="${focusedTaskId}"]`);
      if (el) el.classList.add('focused');
    }
  }

  function appendNodeToColumn(nodeEl, status) {
    if (status === 'TODO') listTodo.appendChild(nodeEl);
    else if (status === 'IN_PROGRESS') listInProgress.appendChild(nodeEl);
    else if (status === 'DONE') listDone.appendChild(nodeEl);
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

  function createTaskCard(task) {
    const item = document.createElement('div');
    item.className = `task-item ${focusedTaskId === task.id ? 'focused' : ''}`;
    item.setAttribute('draggable', 'true');
    item.dataset.taskId = task.id;

    item.addEventListener('click', (e) => {
      e.stopPropagation();
      setFocusedTask(task.id);
    });

    // Drag Events
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

    // Parenting Drop Target
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
    if (children.length > 0 && currentViewMode === 'TREE_VIEW') {
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

    // Parent Task Progress Bar (if parent task has children)
    if (children.length > 0) {
      const completedCount = children.filter((c) => c.status === 'DONE').length;
      const percentage = Math.round((completedCount / children.length) * 100);

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

    // Card Footer with All-Level Status Button Selector
    const footer = document.createElement('div');
    footer.className = 'task-footer';

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

    const authorSpan = document.createElement('span');
    authorSpan.textContent = `By: ${task.authorNodeId || 'local'}`;

    footer.appendChild(statusGroup);
    footer.appendChild(authorSpan);
    item.appendChild(footer);

    return item;
  }

  function setFocusedTask(taskId) {
    focusedTaskId = taskId;
    document.querySelectorAll('.task-item').forEach((el) => {
      if (el.dataset.taskId === taskId) {
        el.classList.add('focused');
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
        renderBoard();
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
  initWebSocket();
})();
