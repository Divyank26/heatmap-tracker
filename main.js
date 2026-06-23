import Database from '@tauri-apps/plugin-sql';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification
} from '@tauri-apps/plugin-notification';

const db = await Database.load('sqlite:heatmap.db');

await db.execute(`
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  text TEXT NOT NULL,
  completed INTEGER DEFAULT 0
)
`);

await db.execute(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)
`);

const heatmap = document.getElementById('heatmap');
const taskList = document.getElementById('task-list');
const taskInput = document.getElementById('task-input');
const currentStreakEl =
  document.getElementById('current-streak');

const bestStreakEl =
  document.getElementById('best-streak');

const monthLabels =
  document.getElementById('month-labels');
function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');

  return `${y}-${m}-${d}`;
}

function getDateDaysAgo(days) {
  const d = new Date();

  d.setHours(0, 0, 0, 0);

  d.setDate(d.getDate() - days);

  return formatDate(d);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function getSetting(key) {

  const result = await db.select(
    `
    SELECT value
    FROM settings
    WHERE key = $1
    `,
    [key]
  );

  return result[0]?.value ?? null;
}

async function setSetting(
  key,
  value
) {

  await db.execute(
    `
    INSERT INTO settings (key, value)
    VALUES ($1, $2)
    ON CONFLICT(key)
    DO UPDATE SET value = $2
    `,
    [key, value]
  );
}

let selectedDate = formatDate(new Date());

async function loadTasks() {
  const rows = await db.select('SELECT * FROM tasks');

  renderMonthLabels();
  renderHeatmap(rows);
  renderTasks(rows);
  renderStreaks(rows);
}

function calculateStreaks(rows) {

  const completedDates = new Set();

  rows.forEach(task => {
    if (task.completed) {
      completedDates.add(task.date);
    }
  });

  let currentStreak = 0;

  let today = getDateDaysAgo(0);

  let yesterday = getDateDaysAgo(1);

  const startDate =
    completedDates.has(today)
      ? today
      : completedDates.has(yesterday)
      ? yesterday
      : null;

  if (startDate) {

    let offset = 0;

    while (true) {

      const d = getDateDaysAgo(offset);

      if (!completedDates.has(d))
        break;

      currentStreak++;

      offset++;
    }
  }

  let bestStreak = 0;

  const sortedDates =
    [...completedDates].sort();

  let streak = 1;

  for (let i = 1; i < sortedDates.length; i++) {

    const prev =
      new Date(sortedDates[i - 1]);

    const curr =
      new Date(sortedDates[i]);

    const diffDays =
      (curr - prev) /
      (1000 * 60 * 60 * 24);

    if (diffDays === 1) {

      streak++;

    } else {

      bestStreak =
        Math.max(bestStreak, streak);

      streak = 1;
    }
  }

  bestStreak =
    Math.max(bestStreak, streak);

  return {
    currentStreak,
    bestStreak
  };
}

function renderStreaks(rows) {

  const {
    currentStreak,
    bestStreak
  } = calculateStreaks(rows);

  currentStreakEl.textContent =
    currentStreak;

  bestStreakEl.textContent =
    bestStreak;
}

function renderMonthLabels() {
  monthLabels.innerHTML = '';

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Find the start date (364 days ago)
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - 364);
  const startDayOfWeek = startDate.getDay(); // 0=Sun ... 6=Sat

  // Total columns needed
  const totalCells = 365 + startDayOfWeek;
  const totalCols = Math.ceil(totalCells / 7);

  // Build a map: column index → month name
  // We want the label to appear at the column where the 1st of a month falls
  const monthMap = new Map();

  for (let i = 364; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);

    if (d.getDate() === 1) {
      const month = d.toLocaleString('default', { month: 'short' });
      // cellIndex in the flat grid (with padding)
      const cellIndex = (364 - i) + startDayOfWeek;
      const col = Math.floor(cellIndex / 7);
      if (!monthMap.has(month)) {
        monthMap.set(month, col);
      }
    }
  }

  // Create one div per column
  for (let i = 0; i < totalCols; i++) {
    const slot = document.createElement('div');
    // If this column has a month label, add it
    if (monthMap.has([...monthMap.keys()].find(k => monthMap.get(k) === i))) {
      const month = [...monthMap.keys()].find(k => monthMap.get(k) === i);
      const label = document.createElement('span');
      label.textContent = month;
      label.className = 'month-label';
      slot.appendChild(label);
    }
    monthLabels.appendChild(slot);
  }
}

function renderHeatmap(rows) {
  heatmap.innerHTML = '';

  const counts = {};
  rows.forEach(task => {
    if (!task.completed) return;
    counts[task.date] = (counts[task.date] || 0) + 1;
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // How many days offset so column 0 starts on Sunday
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - 364);
  const startDayOfWeek = startDate.getDay(); // 0=Sun, 6=Sat

  // Add transparent padding cells so first real day lands on correct row
  for (let p = 0; p < startDayOfWeek; p++) {
    const empty = document.createElement('div');
    empty.className = 'cell cell-empty';
    heatmap.appendChild(empty);
  }

  // Render 365 actual day cells
  for (let i = 364; i >= 0; i--) {
    const d = new Date(today);
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
    cell.title = `${count} completed tasks on ${date}`;

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


async function checkPendingTasksAndNotify() {

  try {

    const now = new Date();

    const todayString =
      formatDate(now);

    // Only after 8 PM
    if (now.getHours() < 20) {
      return;
    }

    const lastNotificationDate =
      await getSetting(
        'lastNotificationDate'
      );

    // Already handled today
    if (
      lastNotificationDate ===
      todayString
    ) {
      return;
    }

    const result =
      await db.select(
        `
        SELECT COUNT(*) AS count
        FROM tasks
        WHERE date = $1
        AND completed = 0
        `,
        [todayString]
      );

    const pendingCount =
      Number(
        result[0]?.count || 0
      );

    // No pending tasks
    if (pendingCount === 0) {

      await setSetting(
        'lastNotificationDate',
        todayString
      );

      return;
    }

    let permissionGranted =
      await isPermissionGranted();

    if (!permissionGranted) {

      const permission =
        await requestPermission();

      permissionGranted =
        permission === 'granted';
    }

    if (!permissionGranted) {
      return;
    }

    await sendNotification({
      title: 'Heatmap Tracker',
      body:
        `You still have ${pendingCount} pending task(s) today. Complete them before the day ends.`
    });

    await setSetting(
      'lastNotificationDate',
      todayString
    );

  } catch (error) {

    console.error(
      'Notification check failed:',
      error
    );
  }
}

loadTasks();

// Run immediately on startup
checkPendingTasksAndNotify();

// Check every minute
setInterval(
  checkPendingTasksAndNotify,
  60000
);