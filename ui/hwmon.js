/* Hardware monitor: every 30 seconds tells the server how busy this computer is (from the windows open and the parts fitted),
   so the temperature and the chance of a blue screen follow real use. Also keeps the latest numbers in LSOS.hw for other apps. */
(function () {
  'use strict';
  var S = window.LSOS;
  if (!S || S.isDui) return;
  var GPU_APPS = { snake: 0, blocks: 1, solitaire: 1, chess: 1, connect4: 0, tictactoe: 0, browser: 1, mining: 1 };
  S.hw = null;
  function load() {
    var wins = S.winList().filter(function (w) { return !w.min; });
    var perf = (S.hw && S.hw.perf > 0) ? S.hw.perf : 1;
    var gpuPerf = (S.hw && S.hw.gpuPerf > 0) ? S.hw.gpuPerf : 1;
    var g = wins.filter(function (w) { return GPU_APPS[w.id]; }).length;
    return { cpu: Math.round(Math.min(100, (3 + 6 * wins.length) / perf)), gpu: Math.round(Math.min(100, g * 25 / gpuPerf)) };
  }
  function tick() {
    if (!document.getElementById('root') || !document.getElementById('root').classList.contains('open')) return;
    S.api('hardwareApi', {}).then(function (r) {
      if (r && r.success) S.hw = r;
      S.api('hardwareApi', { name: 'telemetry', data: load() });
    });
  }
  setInterval(tick, 30000);
  setTimeout(tick, 4000);
})();
