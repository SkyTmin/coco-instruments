// Entry point: starts the HTTP server and the reminders scheduler.
// All routes and app logic live in app.js (importable by tests).
import { app, checkReminders, flushRemindersNow, hasBotToken } from './app.js';

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

if (hasBotToken) {
  setInterval(() => checkReminders().catch((e) => console.error('reminders tick', e)), 60_000);
  console.log('Reminders scheduler active');
} else {
  console.log('Reminders disabled (no BOT_TOKEN set)');
}

// Graceful shutdown: flush debounced reminder writes to disk before exiting so
// a systemd restart never loses recent changes.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down`);
  flushRemindersNow();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { server };
