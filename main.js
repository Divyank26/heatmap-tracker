import Database from '@tauri-apps/plugin-sql';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';

const db = await Database.load('sqlite:heatmap.db');
await db.execute(`CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY, date TEXT NOT NULL, text TEXT NOT NULL, completed INTEGER DEFAULT 0)`);
await db.execute(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
let tasks = [];
let selectedDate = formatDate(new Date());

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function daysAgo(days) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return date;
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
function getSetting(key) {
  return db.select('SELECT value FROM settings WHERE key = $1', [key]).then(rows => rows[0]?.value ?? null);
}
function setSetting(key, value) {
  return db.execute('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = $2', [key, value]);
}

function calculateStreaks(rows) {
  const dates = new Set(rows.filter(task => task.completed).map(task => task.date));
  let currentStreak = 0;
  const startOffset = dates.has(formatDate(daysAgo(0))) ? 0 : dates.has(formatDate(daysAgo(1))) ? 1 : -1;
  if (startOffset >= 0) {
    for (let offset = startOffset; dates.has(formatDate(daysAgo(offset))); offset++) currentStreak++;
  }
  const sorted = [...dates].sort();
  let bestStreak = 0;
  let streak = 0;
  let previous = null;
  sorted.forEach(dateString => {
    const date = new Date(`${dateString}T00:00:00`);
    const consecutive = previous && Math.round((date - previous) / 86400000) === 1;
    streak = consecutive ? streak + 1 : 1;
    bestStreak = Math.max(bestStreak, streak);
    previous = date;
  });
  return { currentStreak, bestStreak };
}

function renderHeatmap(rows, heatmap, labels, compact = false) {
  if (!heatmap || !labels) return;
  const scroller = heatmap.closest('.heatmap-scroll');
  const previousScroll = scroller ? scroller.scrollLeft : 0;
  heatmap.replaceChildren();
  labels.replaceChildren();
  const today = daysAgo(0);
  const earliestTaskDate = rows.reduce((earliest, task) => task.date < earliest ? task.date : earliest, formatDate(today));
  const start = compact ? new Date(today) : new Date(`${earliestTaskDate}T00:00:00`);
  if (compact) start.setDate(start.getDate() - 364);
  else start.setDate(start.getDate() - start.getDay());
  const dayCount = Math.max(1, Math.floor((today - start) / 86400000) + 1);
  const leading = start.getDay();
  const counts = {};
  rows.forEach(task => {
    if (task.completed) counts[task.date] = (counts[task.date] || 0) + 1;
  });
  const monthColumns = new Map();
  for (let offset = 0; offset < dayCount; offset++) {
    const date = new Date(start);
    date.setDate(date.getDate() + offset);
    if (date.getDate() === 1) monthColumns.set(Math.floor((offset + leading) / 7), date.toLocaleString(undefined, { month: 'short' }));
  }
  const columns = Math.ceil((dayCount + leading) / 7);
  for (let column = 0; column < columns; column++) {
    const slot = document.createElement('div');
    const label = monthColumns.get(column);
    if (label) {
      const text = document.createElement('span');
      text.className = 'month-label';
      text.textContent = label;
      slot.append(text);
    }
    labels.append(slot);
  }
  for (let i = 0; i < leading; i++) {
    const empty = document.createElement('div');
    empty.className = 'cell cell-empty';
    heatmap.append(empty);
  }
  for (let offset = 0; offset < dayCount; offset++) {
    const date = new Date(start);
    date.setDate(date.getDate() + offset);
    const key = formatDate(date);
    const count = counts[key] || 0;
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = `cell${count >= 1 ? ' lvl-1' : ''}${count >= 3 ? ' lvl-2' : ''}${count >= 5 ? ' lvl-3' : ''}${count >= 8 ? ' lvl-4' : ''}`;
    cell.title = `${count} completed ${count === 1 ? 'task' : 'tasks'} on ${key}`;
    cell.setAttribute('aria-label', cell.title);
    if (key === selectedDate && !compact) cell.classList.add('selected-cell');
    if (!compact) cell.addEventListener('click', () => {
      selectedDate = key;
      renderHeatmap(tasks, $('#full-heatmap'), $('#month-labels'));
      renderTaskList();
    });
    heatmap.append(cell);
  }
  if (scroller && previousScroll) scroller.scrollLeft = previousScroll;
}

function scrollActiveHeatmapsToEnd() {
  $$('.page-view.active .heatmap-scroll').forEach(el => { el.scrollLeft = el.scrollWidth; });
}

function renderTaskList() {
  const list = $('#task-list');
  const dayTasks = tasks.filter(task => task.date === selectedDate).sort((a, b) => a.id - b.id);
  const heading = new Date(`${selectedDate}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  $('#selected-date-heading').textContent = `Tasks for ${heading}`;
  $('#selected-date-count').textContent = `${dayTasks.length} ${dayTasks.length === 1 ? 'TASK' : 'TASKS'}`;
  list.replaceChildren();
  if (!dayTasks.length) {
    const empty = document.createElement('li');
    empty.className = 'task-empty';
    empty.textContent = 'No tasks for this day. Add one above to get started.';
    list.append(empty);
    return;
  }
  dayTasks.forEach(task => {
    const row = document.createElement('li');
    row.className = `task-row${task.completed ? ' completed' : ''}`;
    row.innerHTML = `<label class="task-main"><input type="checkbox" ${task.completed ? 'checked' : ''} aria-label="Mark ${escapeHtml(task.text)} complete"><span>${escapeHtml(task.text)}</span></label><div class="task-actions"><button class="edit-task" type="button" aria-label="Edit task">Edit</button><button class="delete-task" type="button" aria-label="Delete task">Delete</button></div>`;
    row.querySelector('input').addEventListener('change', async event => {
      await db.execute('UPDATE tasks SET completed = $1 WHERE id = $2', [event.target.checked ? 1 : 0, task.id]);
      await loadTasks();
    });
    row.querySelector('.delete-task').addEventListener('click', async () => {
      await db.execute('DELETE FROM tasks WHERE id = $1', [task.id]);
      await loadTasks();
    });
    row.querySelector('.edit-task').addEventListener('click', async () => {
      const updatedText = window.prompt('Edit task', task.text);
      if (updatedText === null) return;
      const text = updatedText.trim();
      if (!text || text === task.text) return;
      await db.execute('UPDATE tasks SET text = $1 WHERE id = $2', [text, task.id]);
      await loadTasks();
    });
    list.append(row);
  });
}

function renderRecent(target, rows, empty) {
  const body = $(target);
  body.replaceChildren();
  const recent = [...rows].sort((a, b) => b.date.localeCompare(a.date) || Number(b.id) - Number(a.id)).slice(0, 7);
  $(empty).hidden = recent.length > 0;
  recent.forEach(task => {
    const row = document.createElement('tr');
    row.innerHTML = `<td class="date-cell">${new Date(`${task.date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</td><td class="activity-task">${escapeHtml(task.text)}</td><td><span class="status-pill ${task.completed ? 'status-done' : 'status-pending'}"><i></i>${task.completed ? 'Completed' : 'In progress'}</span></td>`;
    body.append(row);
  });
}

function getWeekdaySummary(rows) {
  const counts = Array.from({ length: 7 }, () => 0);
  rows.filter(task => task.completed).forEach(task => counts[new Date(`${task.date}T00:00:00`).getDay()]++);
  return counts;
}

function renderLineChart(target, series, labels, large = false) {
  const host = $(target);
  const gradientId = `chart-fill-${target.replace(/\W/g, '')}`;
  const width = large ? 900 : 520;
  const height = large ? 250 : 190;
  const left = 36;
  const right = 8;
  const top = 14;
  const bottom = 29;
  const max = Math.max(...series, 1);
  const chartHeight = height - top - bottom;
  const points = series.map((value, index) => ({ x: left + index * (width - left - right) / Math.max(series.length - 1, 1), y: top + chartHeight - value / max * chartHeight }));
  const polyline = points.map(point => `${point.x},${point.y}`).join(' ');
  const area = `${left},${height - bottom} ${polyline} ${width - right},${height - bottom}`;
  const grid = [0, 1, 2, 3].map(index => {
    const y = top + index * chartHeight / 3;
    const value = Math.round(max * (3 - index) / 3);
    return `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" class="chart-gridline"/><text x="${left - 9}" y="${y + 4}" class="axis-label" text-anchor="end">${value}</text>`;
  }).join('');
  const tickCount = Math.min(7, labels.length);
  const ticks = Array.from({ length: tickCount }, (_, index) => {
    const dataIndex = Math.round(index * (labels.length - 1) / Math.max(tickCount - 1, 1));
    const point = points[dataIndex];
    return `<text x="${point.x}" y="${height - 7}" class="axis-label" text-anchor="middle">${labels[dataIndex]}</text>`;
  }).join('');
  const dots = points.map((point, index) => `<circle cx="${point.x}" cy="${point.y}" r="${series.length <= 20 ? 3.5 : 2}" class="chart-point"><title>${labels[index]}: ${series[index]} completed</title></circle>`).join('');
  host.innerHTML = `<svg class="line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Completed tasks over time"><defs><linearGradient id="${gradientId}" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#47b881" stop-opacity=".2"/><stop offset="100%" stop-color="#47b881" stop-opacity="0"/></linearGradient></defs>${grid}<polygon points="${area}" class="chart-area" fill="url(#${gradientId})"/><polyline points="${polyline}" class="chart-line"/>${dots}${ticks}</svg>`;
}

function renderDashboard(rows) {
  const completed = rows.filter(task => task.completed);
  const activeDates = new Set(completed.map(task => task.date));
  const rate = rows.length ? Math.round(completed.length / rows.length * 100) : 0;
  $('#metric-total').textContent = rows.length.toLocaleString();
  $('#metric-completed').textContent = completed.length.toLocaleString();
  $('#metric-completed-foot').textContent = `${rate}% of tracked tasks`;
  $('#metric-days').textContent = activeDates.size.toLocaleString();
  $('#metric-rate').textContent = `${rate}%`;
  $('#today-label').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase();
  const streaks = calculateStreaks(rows);
  $('#dashboard-current-streak').textContent = streaks.currentStreak;
  $('#dashboard-best-streak').textContent = streaks.bestStreak;
  $('#current-streak').textContent = `${streaks.currentStreak} ${streaks.currentStreak === 1 ? 'day' : 'days'}`;
  $('#best-streak').textContent = `${streaks.bestStreak} ${streaks.bestStreak === 1 ? 'day' : 'days'}`;
  const weekdayCounts = getWeekdaySummary(rows);
  const peak = Math.max(...weekdayCounts);
  $('#most-active-day').textContent = peak ? ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][weekdayCounts.indexOf(peak)] : 'No activity yet';

  renderHeatmap(rows, $('#dashboard-heatmap'), $('#dashboard-month-labels'), true);
  const trendSeries = Array.from({ length: 14 }, (_, index) => {
    const day = formatDate(daysAgo(13 - index));
    return completed.filter(task => task.date === day).length;
  });
  const trendLabels = Array.from({ length: 14 }, (_, index) => daysAgo(13 - index).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
  renderLineChart('#trend-chart', trendSeries, trendLabels);
  $('#trend-total').textContent = `${trendSeries.reduce((sum, count) => sum + count, 0)} completed`;
  renderRecent('#recent-activity', rows, '#recent-empty');
  renderAnalytics(rows);
}

function renderAnalytics(rows) {
  const range = $('#analytics-range').value;
  const limit = range === 'all' ? Infinity : Number(range);
  const cutoff = limit === Infinity ? null : formatDate(daysAgo(limit - 1));
  const selected = cutoff ? rows.filter(task => task.date >= cutoff) : rows;
  const completed = selected.filter(task => task.completed);
  const activeDays = new Set(completed.map(task => task.date)).size;
  $('#analytics-total').textContent = selected.length.toLocaleString();
  $('#analytics-completed').textContent = completed.length.toLocaleString();
  $('#analytics-rate').textContent = `${selected.length ? Math.round(completed.length / selected.length * 100) : 0}%`;
  $('#analytics-days').textContent = activeDays.toLocaleString();
  let days = limit;
  if (range === 'all') {
    const earliest = selected.reduce((min, task) => (task.date < min ? task.date : min), formatDate(daysAgo(0)));
    days = Math.max(14, Math.round((daysAgo(0) - new Date(`${earliest}T00:00:00`)) / 86400000) + 1);
  }
  const bucketSize = Math.max(1, Math.ceil(days / 90));
  const bucketCount = Math.ceil(days / bucketSize);
  const first = daysAgo(days - 1);
  const completedByDate = {};
  completed.forEach(task => { completedByDate[task.date] = (completedByDate[task.date] || 0) + 1; });
  const series = [];
  const labels = [];
  for (let index = 0; index < bucketCount; index++) {
    let total = 0;
    for (let step = 0; step < bucketSize; step++) {
      const day = new Date(first);
      day.setDate(day.getDate() + index * bucketSize + step);
      total += completedByDate[formatDate(day)] || 0;
    }
    const start = new Date(first);
    start.setDate(start.getDate() + index * bucketSize);
    series.push(total);
    labels.push(start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
  }
  $('#analytics-chart-sub').textContent = bucketSize === 1 ? 'Daily completed tasks' : `Completed tasks per ${bucketSize}-day period`;
  renderLineChart('#analytics-chart', series, labels, true);
  const weekdays = getWeekdaySummary(selected);
  const max = Math.max(...weekdays, 1);
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  $('#weekday-chart').innerHTML = weekdays.map((value, index) => `<div class="weekday-row"><span>${names[index]}</span><div class="weekday-track"><i style="width:${value ? Math.max(5, value / max * 100) : 0}%"></i></div><strong>${value}</strong></div>`).join('');
  renderRecent('#analytics-recent', selected, '#analytics-empty');
}

async function loadTasks() {
  try {
    tasks = await db.select('SELECT * FROM tasks');
    $('#dashboard-error').hidden = true;
    renderDashboard(tasks);
    renderHeatmap(tasks, $('#full-heatmap'), $('#month-labels'));
    renderTaskList();
  } catch (error) {
    console.error('Unable to load tracker data:', error);
    $('#dashboard-error').textContent = 'We couldn’t load your local tracker data. Please restart the app and try again.';
    $('#dashboard-error').hidden = false;
  }
}

let notificationsDenied = false;
async function checkPendingTasksAndNotify() {
  if (notificationsDenied) return;
  try {
    const today = formatDate(new Date());
    if (new Date().getHours() < 20 || await getSetting('lastNotificationDate') === today) return;
    const result = await db.select('SELECT COUNT(*) AS count FROM tasks WHERE date = $1 AND completed = 0', [today]);
    const count = Number(result[0]?.count || 0);
    if (!count) { await setSetting('lastNotificationDate', today); return; }
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === 'granted';
    if (!granted) { notificationsDenied = true; return; }
    await sendNotification({ title: 'Heatmap Tracker', body: `You still have ${count} pending task(s) today. Complete them before the day ends.` });
    await setSetting('lastNotificationDate', today);
  } catch (error) {
    console.error('Notification check failed:', error);
  }
}

function navigate() {
  const page = location.hash.slice(1) || 'dashboard';
  const validPage = ['dashboard', 'heatmap', 'analytics'].includes(page) ? page : 'dashboard';
  $$('.page-view').forEach(view => view.classList.toggle('active', view.dataset.view === validPage));
  $$('.nav-link').forEach(link => {
    const active = link.dataset.page === validPage;
    link.classList.toggle('active', active);
    active ? link.setAttribute('aria-current', 'page') : link.removeAttribute('aria-current');
  });
  $('#current-page-label').textContent = validPage[0].toUpperCase() + validPage.slice(1);
  window.scrollTo(0, 0);
  scrollActiveHeatmapsToEnd();
}

let adding = false;
$('#add-btn').addEventListener('click', async () => {
  if (adding) return;
  const input = $('#task-input');
  const text = input.value.trim();
  if (!text) { input.focus(); return; }
  adding = true;
  try {
    await db.execute('INSERT INTO tasks (date, text, completed) VALUES ($1, $2, $3)', [selectedDate, text, 0]);
    input.value = '';
    await loadTasks();
  } catch (error) {
    console.error('Unable to add task:', error);
  } finally {
    adding = false;
    input.focus();
  }
});
$('#task-input').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.isComposing) $('#add-btn').click();
});
$('#analytics-range').addEventListener('change', () => renderAnalytics(tasks));
window.addEventListener('hashchange', navigate);
$('#dashboard-heatmap').addEventListener('click', () => { location.hash = '#heatmap'; });
let currentDay = formatDate(new Date());
function checkDayChange() {
  const today = formatDate(new Date());
  if (today === currentDay) return;
  if (selectedDate === currentDay) selectedDate = today;
  currentDay = today;
  loadTasks();
}
navigate();
await loadTasks();
scrollActiveHeatmapsToEnd();
checkPendingTasksAndNotify();
setInterval(() => { checkDayChange(); checkPendingTasksAndNotify(); }, 60000);