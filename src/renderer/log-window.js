const output = document.getElementById('logOutput');

function render(lines) {
  output.textContent = lines.length ? lines.join('\n') : 'No activity yet.';
  output.scrollTop = output.scrollHeight;
}

window.addEventListener('DOMContentLoaded', async () => {
  window.feather?.replace();
  render(await window.clipMaker.getLog());
  window.clipMaker.onLog((line) => {
    const current = output.textContent === 'No activity yet.' ? '' : output.textContent;
    output.textContent = current ? `${current}\n${line}` : line;
    output.scrollTop = output.scrollHeight;
  });
  window.clipMaker.onLogCleared(() => render([]));
  document.getElementById('clearBtn').addEventListener('click', () => window.clipMaker.clearLog());
  document.getElementById('hideBtn').addEventListener('click', () => window.clipMaker.hideLogWindow());
});
