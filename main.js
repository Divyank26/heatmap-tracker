import Database from '@tauri-apps/plugin-sql';

const db = await Database.load('sqlite:heatmap.db');

await db.execute(`
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  text TEXT NOT NULL,
  completed INTEGER DEFAULT 0
)
`);

const heatmap = document.getElementById('heatmap');
const taskList = document.getElementById('task-list');
const taskInput = document.getElementById('task-input');

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');

  return `${y}-${m}-${d}`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

let selectedDate = formatDate(new Date());

async function loadTasks() {
  const rows = await db.select('SELECT * FROM tasks');

  renderHeatmap(rows);
  renderTasks(rows);
}

function renderHeatmap(rows) {
  heatmap.innerHTML = '';

  const counts = {};

  rows.forEach(task => {
    if (!task.completed) return;

    counts[task.date] =
      (counts[task.date] || 0) + 1;
  });

  for (let i = 364; i >= 0; i--) {
    const d = new Date();

    d.setDate(d.getDate() - i);

    const date = formatDate(d);

    const count = counts[date] || 0;

    const cell = document.createElement('div');

    let cls = 'cell';

    if (count >= 1) cls += ' lvl-1';
    if (count >= 3) cls += ' lvl-2';
    if (count >= 5) cls += ' lvl-3';
    if (count >= 8) cls += ' lvl-4';

    cell.className = cls;

   cell.title =
  `${count} completed tasks on ${date}`;

    // highlight selected date
    if (date === selectedDate) {
        cell.style.outline = '2px solid #24292e';
    }

    cell.addEventListener('click', () => {
    selectedDate = date;

    renderHeatmap(rows);
    renderTasks(rows);
    });

    heatmap.appendChild(cell);
  }
}

function renderTasks(rows) {
  taskList.innerHTML = '';

  const dayTasks = rows.filter(
    t => t.date === selectedDate
  );

  if (dayTasks.length === 0) {
    taskList.innerHTML = `
      <li class="empty-state">
        No tasks for this day.
      </li>
    `;

    return;
  }

  dayTasks.forEach(task => {
    const li = document.createElement('li');

    li.className = task.completed
      ? 'completed'
      : '';

    li.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;">
        <input
          type="checkbox"
          ${task.completed ? 'checked' : ''}
        />

        <span>${escapeHtml(task.text)}</span>
      </div>

      <button data-id="${task.id}">
        Delete
      </button>
    `;

    const checkbox = li.querySelector('input');

    checkbox.addEventListener('change', async () => {
      await db.execute(
        'UPDATE tasks SET completed = $1 WHERE id = $2',
        [checkbox.checked ? 1 : 0, task.id]
      );

      loadTasks();
    });

    const deleteBtn = li.querySelector('button');

    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();

      await db.execute(
        'DELETE FROM tasks WHERE id = $1',
        [task.id]
      );

      loadTasks();
    });

    taskList.appendChild(li);
  });
}

document
  .getElementById('add-btn')
  .addEventListener('click', async () => {
    const text = taskInput.value.trim();

    if (!text) return;

    await db.execute(
      'INSERT INTO tasks (date, text, completed) VALUES ($1, $2, $3)',
      [selectedDate, text, 0]
    );

    taskInput.value = '';

    loadTasks();
  });

taskInput.addEventListener('keydown', async (e) => {
  if (e.key === 'Enter') {
    document.getElementById('add-btn').click();
  }
});

loadTasks();