// 시험용 가짜 docker. RAUHA_DOCKER_BIN 이 이 파일을 가리키면 진짜 docker 대신 돈다. 받은 인자는 FAKE_DOCKER_LOG 파일에 한 줄씩 쌓는다.
const fs = require('node:fs');
const args = process.argv.slice(2);
if (process.env.FAKE_DOCKER_LOG) fs.appendFileSync(process.env.FAKE_DOCKER_LOG, JSON.stringify(args) + '\n');
const mode = process.env.FAKE_DOCKER_MODE || 'ok';
const out = (s) => process.stdout.write(s + '\n');
const key = args.slice(0, 2).join(' ');
if (mode === 'off') {
  if (args[0] === 'version') out(JSON.stringify({ Client: { Version: '29.9.2' } }));
  process.stderr.write('failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine; check if the path is correct and if the daemon is running\n');
  process.exit(1);
}
if (args[0] === 'version') out(JSON.stringify({ Client: { Version: '29.9.2' }, Server: { Version: '27.0.1' } }));
else if (args[0] === 'ps') {
  out(JSON.stringify({ ID: 'abc123', Names: 'web', Image: 'nginx:latest', State: 'running', Status: 'Up 2 hours', Ports: '0.0.0.0:8080->80/tcp', CreatedAt: '2026-11-11 09:00:00 +0900 KST', Labels: '' }));
  out(JSON.stringify({ ID: 'def456', Names: 'db', Image: 'postgres:16', State: 'exited', Status: 'Exited (0) 3 days ago', Ports: '', CreatedAt: '2026-11-08 09:00:00 +0900 KST', Labels: 'com.docker.compose.project=shop' }));
  out('not json');
} else if (args[0] === 'images') out(JSON.stringify({ ID: 'img1', Repository: 'nginx', Tag: 'latest', Size: '187MB', CreatedAt: '2026-11-01 09:00:00 +0900 KST' }));
else if (key === 'volume ls') out(JSON.stringify({ Name: 'pgdata', Driver: 'local', Mountpoint: '/var/lib/docker/volumes/pgdata/_data' }));
else if (key === 'network ls') out(JSON.stringify({ ID: 'n1', Name: 'bridge', Driver: 'bridge', Scope: 'local' }));
else if (args[0] === 'logs') {
  process.stdout.write('line one\nline two\n');
  process.stderr.write('warn line\n');
} else if (args[0] === 'compose' && args.includes('ps')) out(JSON.stringify([{ Name: 'shop-db-1', Service: 'db', State: 'running', Status: 'Up 1 minute', Image: 'postgres:16' }]));
else if (args[0] === 'compose' && args[1] === 'ls') out(JSON.stringify([{ Name: 'shop', Status: 'running(1)', ConfigFiles: '/w/compose.yaml' }]));
else if (args[0] === 'exec') out('hello from ' + args[1]);
else if (args[0] === 'inspect') out(JSON.stringify([{ Id: 'abc123def4567890', Name: '/web', Config: { Image: 'nginx:latest', Env: ['SECRET=1'] }, State: { Status: 'running', StartedAt: '2026-11-11T00:00:00Z' }, NetworkSettings: { Ports: {}, Networks: {} }, Mounts: [], Path: 'nginx', Args: [] }]));
else out('ok');
