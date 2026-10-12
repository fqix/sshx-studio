// Portable stand-in for `nc host port` in ProxyCommand tests: pipes stdin/stdout to a TCP socket.
const net = require('net');
const [host, port] = process.argv.slice(2);
const sock = net.connect(Number(port), host);
process.stdin.pipe(sock).pipe(process.stdout);
sock.on('error', (e) => {
  process.stderr.write(String(e));
  process.exit(1);
});
sock.on('close', () => process.exit(0));
