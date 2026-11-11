import { parentPort, workerData } from 'node:worker_threads';
import { scanFiles, type ScanJob } from './search-scan.js';

/**
 * 전체 찾기 worker 의 진입점. main 이 이 코드를 묶어 문자열로 들고 있다가 `new Worker(source, { eval: true })`로 띄운다.
 * 정규식이 끝나지 않으면 main 이 worker 를 terminate 한다.
 */
if (parentPort !== null) {
  const port = parentPort;
  void scanFiles(workerData as ScanJob, (m) => port.postMessage(m), () => false).catch(() => {
    port.postMessage({ t: 'done', scanned: 0, skipped: 0, limited: false });
  });
}
