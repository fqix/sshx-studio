import type { FileEntry, HostMessage, TransferItem, WebviewMessage } from '@shared/protocol';

/** Fake extension host for browser development. Simulates a tiny filesystem and an echo shell. */
const cancelled = new Set<number>();

/** `?demo=1`: realistic-looking content for README screenshots (no real hosts or data). */
const DEMO = new URLSearchParams(location.search).has('demo');

function demoSession(send: (m: HostMessage) => void) {
  const now = Math.floor(Date.now() / 1000);
  const dir = (name: string, ago = 3600): FileEntry => ({ name, type: 'dir', size: 4096, mtime: now - ago, mode: 0o40755 });
  const file = (name: string, size: number, ago = 7200): FileEntry => ({ name, type: 'file', size, mtime: now - ago, mode: 0o100644 });
  const g = '\x1b[1;32m', b = '\x1b[1;34m', y = '\x1b[33m', d = '\x1b[2m', r = '\x1b[0m';
  const prompt = `${g}deploy@web-01${r}:${b}~${r}$ `;
  send({ type: 'status', state: 'connected', text: 'deploy@web-01.example.com' });
  send({
    type: 'term.data',
    term: 1,
    data:
      `Welcome to Ubuntu 24.04.1 LTS (GNU/Linux 6.8.0-45-generic x86_64)\r\n\r\n` +
      `  System load:  0.08               Processes:             142\r\n` +
      `  Usage of /:   37.2% of 78.12GB   Users logged in:       1\r\n` +
      `  Memory usage: 41%                IPv4 address for eth0: 10.0.12.34\r\n\r\n` +
      `${d}Last login: Mon Oct 12 09:41:07 2026 from 10.0.0.8${r}\r\n` +
      `${prompt}ls\r\n${b}app${r}  ${b}backups${r}  docker-compose.yml  deploy.sh  ${b}logs${r}\r\n` +
      `${prompt}docker compose ps\r\n` +
      `NAME          IMAGE              STATUS         PORTS\r\n` +
      `app-web-1     app/web:1.42.0     ${g}Up 3 days${r}      0.0.0.0:8080->80/tcp\r\n` +
      `app-api-1     app/api:1.42.0     ${g}Up 3 days${r}      127.0.0.1:3000->3000/tcp\r\n` +
      `app-db-1      postgres:16        ${g}Up 3 days${r}      127.0.0.1:5432->5432/tcp\r\n` +
      `app-redis-1   redis:7            ${y}Up 2 hours${r}     6379/tcp\r\n` +
      `${prompt}`,
  });
  send({ type: 'fs.home', home: '/home/deploy' });
  send({
    type: 'fs.listing',
    path: '/home/deploy',
    entries: [
      dir('app', 600), dir('backups', 86400), dir('logs', 300), dir('.config', 864000), dir('.ssh', 864000),
      file('.bashrc', 3771, 8640000), file('deploy.sh', 2184, 172800), file('docker-compose.yml', 1342, 172800),
      file('backup-2026-10-11.tar.gz', 734_003_200, 36000), file('README.md', 4096, 864000),
    ],
  });
  const item = (p: Partial<TransferItem>): TransferItem => ({ id: 0, direction: 'upload', name: '', files: 1, filesDone: 0, totalBytes: 0, doneBytes: 0, bytesPerSecond: 0, status: 'running', canReveal: false, canResume: false, ...p });
  send({
    type: 'transfer.update',
    items: [
      item({ id: 1, direction: 'upload', name: 'release-1.43.0.tar.gz', totalBytes: 96_468_992, doneBytes: 61_865_984, bytesPerSecond: 11_534_336 }),
      item({ id: 2, direction: 'download', name: 'logs', files: 42, filesDone: 17, totalBytes: 24_117_248, doneBytes: 9_961_472, bytesPerSecond: 3_250_585, currentFile: 'api-2026-10-12.log' }),
      item({ id: 3, direction: 'download', name: 'backup-2026-10-11.tar.gz', totalBytes: 734_003_200, doneBytes: 734_003_200, status: 'done', canReveal: true }),
    ],
  });
}

/** Fake transfers with progress so the transfer panel can be developed in a browser. */
function simulateTransfers(send: (m: HostMessage) => void) {
  const items: TransferItem[] = [
    { id: 1, direction: 'upload', name: 'release-build.tar.gz', files: 1, filesDone: 0, totalBytes: 84_000_000, doneBytes: 0, bytesPerSecond: 0, status: 'running', canReveal: false, canResume: false },
    { id: 2, direction: 'download', name: 'logs', files: 37, filesDone: 0, totalBytes: 12_500_000, doneBytes: 0, bytesPerSecond: 0, status: 'running', canReveal: false, canResume: false, currentFile: 'app.log' },
    { id: 3, direction: 'upload', name: 'dump.sql', files: 1, filesDone: 0, totalBytes: 0, doneBytes: 0, bytesPerSecond: 0, status: 'queued', canReveal: false, canResume: false },
    { id: 4, direction: 'download', name: 'secret.key', files: 1, filesDone: 0, totalBytes: 3_200, doneBytes: 0, bytesPerSecond: 0, status: 'error', error: 'Connection lost', canReveal: false, canResume: true },
  ];
  const timer = setInterval(() => {
    for (const it of items) {
      if (cancelled.has(it.id) && (it.status === 'running' || it.status === 'queued')) it.status = 'cancelled';
      if (it.status !== 'running') continue;
      it.bytesPerSecond = it.direction === 'upload' ? 9_800_000 : 2_100_000;
      it.doneBytes = Math.min(it.totalBytes, it.doneBytes + it.bytesPerSecond / 5);
      it.filesDone = Math.floor((it.doneBytes / it.totalBytes) * it.files);
      if (it.doneBytes >= it.totalBytes) {
        it.status = 'done';
        it.canReveal = it.direction === 'download';
        const queued = items.find((x) => x.status === 'queued');
        if (queued) Object.assign(queued, { status: 'running', totalBytes: 30_000_000 });
      }
    }
    send({ type: 'transfer.update', items: items.map((i) => ({ ...i })) });
    if (items.every((i) => i.status !== 'running' && i.status !== 'queued')) clearInterval(timer);
  }, 200);
}

export function createMockHost() {
  const now = Math.floor(Date.now() / 1000);
  const dir = (name: string): FileEntry => ({ name, type: 'dir', size: 4096, mtime: now, mode: 0o40755 });
  const file = (name: string, size: number): FileEntry => ({ name, type: 'file', size, mtime: now, mode: 0o100644 });
  const fsTree: Record<string, FileEntry[]> = {
    '/': [dir('home'), dir('etc'), dir('var')],
    '/home': [dir('dev')],
    '/home/dev': [dir('projects'), dir('.ssh'), file('.bashrc', 3771), file('data.tar.gz', 52_428_800)],
    '/home/dev/projects': [dir('app'), file('README.md', 1200)],
    '/etc': [file('hosts', 220), file('passwd', 1800)],
    '/var': [dir('log')],
  };

  const send = (m: HostMessage) => setTimeout(() => window.postMessage(m, '*'), 30);
  const lines = new Map<number, string>();
  let state: unknown;

  return {
    getState: <T>() => state as T,
    setState: (s: unknown) => void (state = s),
    postMessage(m: WebviewMessage) {
      console.debug('[mock host] ←', m);
      switch (m.type) {
        case 'ready':
          if (DEMO) return demoSession(send);
          send({ type: 'status', state: 'connected', text: 'dev@mock-host' });
          send({ type: 'term.data', term: 1, data: 'Welcome to the mock host.\r\n$ ' });
          send({ type: 'fs.home', home: '/home/dev' });
          send({ type: 'fs.listing', path: '/home/dev', entries: fsTree['/home/dev'] });
          break;
        case 'term.open':
          send({ type: 'term.data', term: m.term, data: `Mock terminal ${m.term} (same connection).\r\n$ ` });
          break;
        case 'term.input': {
          const line = lines.get(m.term) ?? '';
          const out = (data: string) => send({ type: 'term.data', term: m.term, data });
          if (m.data === '\r') {
            out(`\r\n${line ? `mock: ${line}\r\n` : ''}$ `);
            lines.set(m.term, '');
          } else if (m.data === '\x7f') {
            if (line) out('\b \b');
            lines.set(m.term, line.slice(0, -1));
          } else {
            lines.set(m.term, line + m.data);
            out(m.data);
          }
          break;
        }
        case 'local.list': {
          const p = m.path || '/Users/dev/project';
          const localTree: Record<string, FileEntry[]> = {
            '/Users/dev': [
              { name: 'project', type: 'dir', size: 0, mtime: 1760000000, mode: 0o40755 },
              { name: 'Downloads', type: 'dir', size: 0, mtime: 1760000000, mode: 0o40755 },
            ],
            '/Users/dev/project': [
              { name: 'src', type: 'dir', size: 0, mtime: 1760000000, mode: 0o40755 },
              { name: 'package.json', type: 'file', size: 1834, mtime: 1760000000, mode: 0o100644 },
              { name: 'release-build.tar.gz', type: 'file', size: 84_000_000, mtime: 1760000000, mode: 0o100644 },
            ],
          };
          if (localTree[p]) send({ type: 'local.listing', path: p, parent: p.replace(/\/[^/]+$/, '') || '/', home: '/Users/dev', sep: '/', entries: localTree[p] });
          else send({ type: 'local.error', message: `${p}: (mock) not found` });
          break;
        }
        case 'xfer.upload':
        case 'xfer.download':
          simulateTransfers(send);
          break;
        case 'fs.list': {
          const p = m.path.replace(/\/+$/, '') || '/';
          if (fsTree[p]) send({ type: 'fs.listing', path: p, entries: fsTree[p] });
          else send({ type: 'fs.error', message: `${p}: No such file` });
          break;
        }
        case 'fs.upload':
        case 'fs.download':
          simulateTransfers(send);
          break;
        case 'transfer.cancel':
          cancelled.add(m.id);
          break;
        case 'fs.cdTerminal':
          send({ type: 'term.data', term: m.term, data: `cd '${m.path}'\r\n$ ` });
          break;
        // ---- host editor
        case 'editor.ready':
          if (DEMO) setTimeout(() => send({ type: 'editor.testResult', ok: true, message: 'Connected to deploy@10.0.0.5:22 in 184 ms', details: ['Via ProxyJump bastion', 'SFTP available (home: /home/deploy)'] }), 300);
          send({
            type: 'editor.init',
            state: {
              draft: {
                id: 1, alias: 'prod-web', hostname: '10.0.0.5', port: 22, username: 'deploy', authMethod: 'keyStored',
                identityFile: '', proxyJump: 'bastion', proxyCommand: '', groupId: 2, password: '', clearPassword: false,
                privateKey: '', passphrase: '', clearPassphrase: false, forwardAgent: true, forwardX11: false,
              },
              saved: { password: true, privateKey: true, passphrase: false },
              publicKey: DEMO ? 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOWnOOGFYPqL/ibF51BhDkqQAoHsMR5+N7lg46gnyl8h sshx-studio@macbook' : 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMockMockMockMockMockMockMockMockMockMockMo sshx-studio@dev',
              otherAliases: ['bastion', 'db', 'staging'],
              groups: [{ id: 1, path: 'Production' }, { id: 2, path: 'Production / Web' }, { id: 3, path: 'Staging' }],
            },
          });
          break;
        case 'editor.browseKeyFile':
          send({ type: 'editor.keyFile', path: '/Users/dev/.ssh/id_ed25519' });
          break;
        case 'editor.generateKey':
          send({ type: 'editor.generated', publicKey: `ssh-${m.keyType} AAAAGeneratedGeneratedGeneratedGenerated sshx-studio@dev` });
          break;
        case 'editor.test':
          setTimeout(() => {
            if (m.draft.hostname === 'bad') send({ type: 'editor.testResult', ok: false, message: 'Connection failed: connect ECONNREFUSED 10.0.0.9:22', details: [] });
            else send({ type: 'editor.testResult', ok: true, message: `Connected to ${m.draft.username}@${m.draft.hostname}:${m.draft.port} in 284 ms`, details: [`Via ProxyJump ${m.draft.proxyJump}`, 'SFTP available (home: /home/deploy)'] });
          }, 900);
          break;
        case 'editor.save':
          if (!m.draft.hostname) send({ type: 'editor.error', field: 'hostname', message: 'Host is required.' });
          else send({ type: 'editor.error', message: '(mock) Saved — the real extension would close this tab.' });
          break;
      }
    },
  };
}
