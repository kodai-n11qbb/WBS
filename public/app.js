(function () {
  let socket = null;
  let currentTasks = [];
  let draggedTaskId = null;

  // DOM Elements
  const nodeDisplay = document.getElementById('node-id-display');
  const errorToast = document.getElementById('error-toast');

  const modal = document.getElementById('task-modal');
  const btnOpenModal = document.getElementById('btn-open-modal');
  const btnCloseModal = document.getElementById('btn-close-modal');
  const btnCancelModal = document.getElementById('btn-cancel-modal');
  const structuredForm = document.getElementById('structured-task-form');

  const inputTitle = document.getElementById('input-title');
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

  // Render Kanban Tasks
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

    // Intent Section
    const intentEl = document.createElement('div');
    intentEl.className = 'task-intent';
    intentEl.textContent = `🎯 目的: ${task.intent || '未指定'}`;

    // DoD Section
    const dodSection = document.createElement('div');
    dodSection.className = 'dod-section';
    if (Array.isArray(task.definitionOfDone) && task.definitionOfDone.length > 0) {
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

    item.appendChild(top);
    item.appendChild(intentEl);
    if (task.definitionOfDone && task.definitionOfDone.length > 0) {
      item.appendChild(dodSection);
    }
    item.appendChild(footer);

    return item;
  }

  // Setup HTML5 Drag & Drop for Kanban Columns
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

  // Modal & Structured Form Handling
  function addDodInputRow(textValue = '') {
    const row = document.createElement('div');
    row.className = 'dod-input-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'dod-text-input';
    input.placeholder = '完了条件を入力... (例: 単体テスト全クリア)';
    input.value = textValue;
    input.required = true;

    const btnRemove = document.createElement('button');
    btnRemove.type = 'button';
    btnRemove.className = 'btn-action';
    btnRemove.textContent = '✕';
    btnRemove.onclick = () => {
      if (dodListContainer.children.length > 1) {
        row.remove();
      }
    };

    row.appendChild(input);
    row.appendChild(btnRemove);
    dodListContainer.appendChild(row);
  }

  function openModal() {
    dodListContainer.innerHTML = '';
    addDodInputRow();
    modal.classList.remove('hidden');
    inputTitle.focus();
  }

  function closeModal() {
    modal.classList.add('hidden');
    structuredForm.reset();
  }

  btnOpenModal.addEventListener('click', openModal);
  btnCloseModal.addEventListener('click', closeModal);
  btnCancelModal.addEventListener('click', closeModal);

  btnAddDod.addEventListener('click', () => addDodInputRow());

  structuredForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const title = inputTitle.value.trim();
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

    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          action: 'CREATE_STRUCTURED_TASK',
          title,
          intent,
          priority,
          definitionOfDone,
        })
      );
      closeModal();
    }
  });

  setupDragAndDrop();
  initWebSocket();
})();
