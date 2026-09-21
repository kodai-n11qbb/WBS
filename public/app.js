(function () {
  let socket = null;
  let currentTasks = [];
  let draggedTaskId = null;

  // DOM Elements
  const nodeDisplay = document.getElementById('node-id-display');
  const errorToast = document.getElementById('error-toast');

  const quickForm = document.getElementById('quick-task-form');
  const quickInputTitle = document.getElementById('quick-title-input');

  const modal = document.getElementById('task-modal');
  const btnOpenModal = document.getElementById('btn-open-modal');
  const btnCloseModal = document.getElementById('btn-close-modal');
  const btnCancelModal = document.getElementById('btn-cancel-modal');
  const detailedForm = document.getElementById('detailed-task-form');

  const inputModalTitle = document.getElementById('input-modal-title');
  const selectParentTask = document.getElementById('select-parent-task');
  const inputIntent = document.getElementById('input-intent');
  const selectPriority = document.getElementById('select-priority');
  const dodListContainer = document.getElementById('dod-list');
  const btnAddDod = document.getElementById('btn-add-dod');

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
          renderTasks();
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
    selectParentTask.innerHTML = '<option value="">(親タスクなし - ルートタスク)</option>';
    currentTasks.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = `📁 ${t.title}`;
      selectParentTask.appendChild(opt);
    });
  }

  function renderTasks() {
    listTodo.innerHTML = '';
    listInProgress.innerHTML = '';
    listDone.innerHTML = '';

    const todoTasks = currentTasks.filter((t) => t.status === 'TODO').sort((a, b) => a.orderIndex - b.orderIndex);
    const inProgressTasks = currentTasks.filter((t) => t.status === 'IN_PROGRESS').sort((a, b) => a.orderIndex - b.orderIndex);
    const doneTasks = currentTasks.filter((t) => t.status === 'DONE').sort((a, b) => a.orderIndex - b.orderIndex);

    countTodo.textContent = todoTasks.length;
    countInProgress.textContent = inProgressTasks.length;
    countDone.textContent = doneTasks.length;

    todoTasks.forEach((t) => listTodo.appendChild(createTaskCard(t)));
    inProgressTasks.forEach((t) => listInProgress.appendChild(createTaskCard(t)));
    doneTasks.forEach((t) => listDone.appendChild(createTaskCard(t)));
  }

  function createTaskCard(task) {
    const item = document.createElement('div');
    item.className = 'task-item';
    item.setAttribute('draggable', 'true');
    item.dataset.taskId = task.id;

    // Drag events
    item.addEventListener('dragstart', (e) => {
      draggedTaskId = task.id;
      item.classList.add('dragging');
      e.dataTransfer.setData('text/plain', task.id);
    });

    item.addEventListener('dragend', () => {
      draggedTaskId = null;
      item.classList.remove('dragging');
    });

    // Parent Tree Badge
    if (task.parentId) {
      const parentTask = currentTasks.find((pt) => pt.id === task.parentId);
      const parentBadge = document.createElement('div');
      parentBadge.className = 'parent-badge';
      parentBadge.textContent = `📁 親: ${parentTask ? parentTask.title : '指定タスク'}`;
      item.appendChild(parentBadge);
    }

    // Card Top (Title + Delete)
    const top = document.createElement('div');
    top.className = 'task-top';

    const titleEl = document.createElement('div');
    titleEl.className = 'task-title';
    titleEl.textContent = task.title;

    const btnDelete = document.createElement('button');
    btnDelete.className = 'btn-delete';
    btnDelete.innerHTML = '🗑️';
    btnDelete.title = 'タスクを削除 (Tombstone)';
    btnDelete.onclick = (e) => {
      e.stopPropagation();
      if (confirm(`タスク「${task.title}」を削除しますか？`)) {
        deleteTask(task.id);
      }
    };

    top.appendChild(titleEl);
    top.appendChild(btnDelete);
    item.appendChild(top);

    // Intent (Optional)
    if (task.intent && task.intent.trim().length > 0) {
      const intentEl = document.createElement('div');
      intentEl.className = 'task-intent';
      intentEl.textContent = `🎯 目的: ${task.intent}`;
      item.appendChild(intentEl);
    }

    // DoD Section (Optional)
    if (Array.isArray(task.definitionOfDone) && task.definitionOfDone.length > 0) {
      const dodSection = document.createElement('div');
      dodSection.className = 'dod-section';
      const dodHeader = document.createElement('div');
      dodHeader.className = 'dod-header';
      dodHeader.textContent = '完了定義 (DoD)';
      dodSection.appendChild(dodHeader);

      task.definitionOfDone.forEach((itemDod) => {
        const dodRow = document.createElement('div');
        dodRow.className = `dod-item ${itemDod.completed ? 'completed' : ''}`;
        dodRow.textContent = `${itemDod.completed ? '✓' : '○'} ${itemDod.text}`;
        dodSection.appendChild(dodRow);
      });
      item.appendChild(dodSection);
    }

    // Card Footer
    const footer = document.createElement('div');
    footer.className = 'task-footer';

    const prioritySpan = document.createElement('span');
    prioritySpan.className = `priority-tag priority-${task.priority || 'MEDIUM'}`;
    prioritySpan.textContent = task.priority || 'MEDIUM';

    const authorSpan = document.createElement('span');
    authorSpan.textContent = `By: ${task.authorNodeId || 'local'}`;

    footer.appendChild(prioritySpan);
    footer.appendChild(authorSpan);
    item.appendChild(footer);

    return item;
  }

  // Setup HTML5 Drag & Drop
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

  function sendCreateTask(title, parentId = null, intent = '', definitionOfDone = [], priority = 'MEDIUM') {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          action: 'CREATE_TASK',
          title,
          parentId,
          intent,
          definitionOfDone,
          priority,
        })
      );
    }
  }

  // Quick Form Submit (Title Only)
  quickForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = quickInputTitle.value.trim();
    if (title) {
      sendCreateTask(title);
      quickInputTitle.value = '';
    }
  });

  // Modal & Detailed Form Handling
  function addDodInputRow(textValue = '') {
    const row = document.createElement('div');
    row.className = 'dod-input-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'dod-text-input';
    input.placeholder = '完了条件を入力 (任意)...';
    input.value = textValue;

    const btnRemove = document.createElement('button');
    btnRemove.type = 'button';
    btnRemove.className = 'btn-action';
    btnRemove.textContent = '✕';
    btnRemove.onclick = () => row.remove();

    row.appendChild(input);
    row.appendChild(btnRemove);
    dodListContainer.appendChild(row);
  }

  function openModal() {
    dodListContainer.innerHTML = '';
    inputModalTitle.value = quickInputTitle.value.trim();
    modal.classList.remove('hidden');
    inputModalTitle.focus();
  }

  function closeModal() {
    modal.classList.add('hidden');
    detailedForm.reset();
  }

  btnOpenModal.addEventListener('click', openModal);
  btnCloseModal.addEventListener('click', closeModal);
  btnCancelModal.addEventListener('click', closeModal);

  btnAddDod.addEventListener('click', () => addDodInputRow());

  detailedForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const title = inputModalTitle.value.trim();
    const parentId = selectParentTask.value || null;
    const intent = inputIntent.value.trim();
    const priority = selectPriority.value;

    const dodInputs = dodListContainer.querySelectorAll('.dod-text-input');
    const definitionOfDone = Array.from(dodInputs)
      .map((inp, idx) => ({
        id: `dod-${idx + 1}-${Date.now()}`,
        text: inp.value.trim(),
        completed: false,
      }))
      .filter((item) => item.text.length > 0);

    if (title) {
      sendCreateTask(title, parentId, intent, definitionOfDone, priority);
      closeModal();
      quickInputTitle.value = '';
    }
  });

  setupDragAndDrop();
  initWebSocket();
})();
