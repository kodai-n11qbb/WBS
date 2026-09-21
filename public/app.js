(function () {
  let socket = null;
  let currentTasks = [];

  const nodeDisplay = document.getElementById('node-id-display');
  const taskForm = document.getElementById('create-task-form');
  const titleInput = document.getElementById('task-title-input');

  const listTodo = document.getElementById('list-todo');
  const listInProgress = document.getElementById('list-in-progress');
  const listDone = document.getElementById('list-done');

  const countTodo = document.getElementById('count-todo');
  const countInProgress = document.getElementById('count-in-progress');
  const countDone = document.getElementById('count-done');

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

  function renderTasks() {
    listTodo.innerHTML = '';
    listInProgress.innerHTML = '';
    listDone.innerHTML = '';

    const todoTasks = currentTasks.filter(t => t.status === 'TODO');
    const inProgressTasks = currentTasks.filter(t => t.status === 'IN_PROGRESS');
    const doneTasks = currentTasks.filter(t => t.status === 'DONE');

    countTodo.textContent = todoTasks.length;
    countInProgress.textContent = inProgressTasks.length;
    countDone.textContent = doneTasks.length;

    todoTasks.forEach(t => listTodo.appendChild(createTaskCard(t)));
    inProgressTasks.forEach(t => listInProgress.appendChild(createTaskCard(t)));
    doneTasks.forEach(t => listDone.appendChild(createTaskCard(t)));
  }

  function createTaskCard(task) {
    const item = document.createElement('div');
    item.className = 'task-item';

    const titleEl = document.createElement('div');
    titleEl.className = 'task-title';
    titleEl.textContent = task.title;

    const footer = document.createElement('div');
    footer.className = 'task-footer';

    const authorSpan = document.createElement('span');
    authorSpan.textContent = `By: ${task.authorNodeId || 'local'}`;

    const actions = document.createElement('div');
    actions.className = 'task-actions';

    if (task.status !== 'TODO') {
      const btnPrev = document.createElement('button');
      btnPrev.className = 'btn-action';
      btnPrev.textContent = '←';
      btnPrev.onclick = () => updateStatus(task.id, task.status === 'DONE' ? 'IN_PROGRESS' : 'TODO');
      actions.appendChild(btnPrev);
    }

    if (task.status !== 'DONE') {
      const btnNext = document.createElement('button');
      btnNext.className = 'btn-action';
      btnNext.textContent = '→';
      btnNext.onclick = () => updateStatus(task.id, task.status === 'TODO' ? 'IN_PROGRESS' : 'DONE');
      actions.appendChild(btnNext);
    }

    footer.appendChild(authorSpan);
    footer.appendChild(actions);

    item.appendChild(titleEl);
    item.appendChild(footer);

    return item;
  }

  function updateStatus(taskId, newStatus) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        action: 'UPDATE_STATUS',
        taskId: taskId,
        status: newStatus
      }));
    }
  }

  taskForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = titleInput.value.trim();
    if (title && socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        action: 'CREATE_TASK',
        title: title
      }));
      titleInput.value = '';
    }
  });

  initWebSocket();
})();
