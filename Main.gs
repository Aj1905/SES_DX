// アプリ全体の初期化と定期バッチ実行のエントリーポイントを担う。

function setupApp() {
  const config = AppConfig.load();
  BootstrapService.ensureLabels(config);
  BootstrapService.ensureSheets(config);
  BootstrapService.ensureTrigger(config);
}

function runBatch() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20 * 1000)) {
    Logger.log('Another execution is running. Skip.');
    return;
  }

  try {
    const config = AppConfig.load();
    BootstrapService.ensureLabels(config);
    BootstrapService.ensureSheets(config);

    // 前回バッチで処理中のまま残留したスレッドを復旧
    ProcessingService.recoverStuckThreads(config);

    const threads = GmailRepository.fetchUnprocessedThreads(config);
    const startTime = Date.now();
    const MAX_EXECUTION_MS = 5 * 60 * 1000; // GAS制限6分の手前で停止

    for (const thread of threads) {
      if (Date.now() - startTime > MAX_EXECUTION_MS) {
        Logger.log('Approaching execution time limit. Stopping batch.');
        break;
      }
      ProcessingService.processThread(config, thread);
    }
  } finally {
    lock.releaseLock();
  }
}

function testProcessLatestOne() {
  const config = AppConfig.load();
  const threads = GmailRepository.fetchUnprocessedThreads(config);
  if (threads.length === 0) {
    Logger.log('No target thread found.');
    return;
  }
  ProcessingService.processThread(config, threads[0]);
}