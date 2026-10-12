// Verifies a native .node file matches the expected target by reading its binary header
// (Mach-O / ELF / PE), so a mis-targeted cross-compile can't slip into the VSIX.
// Usage: node scripts/check-native.mjs <target> <file.node>
//        node scripts/check-native.mjs --all <dir>   (every target present & correct)
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { NATIVE_TARGETS, binaryName } from './native-targets.mjs';

function inspect(file) {
  const b = readFileSync(file);
  // Mach-O 64-bit little endian: magic 0xfeedfacf, cputype at offset 4
  if (b.readUInt32LE(0) === 0xfeedfacf) {
    const cpu = b.readUInt32LE(4);
    return { os: 'darwin', arch: cpu === 0x01000007 ? 'x64' : cpu === 0x0100000c ? 'arm64' : `cpu:${cpu.toString(16)}` };
  }
  // ELF: e_machine at offset 18 (little endian for our targets)
  if (b.readUInt32BE(0) === 0x7f454c46) {
    const machine = b.readUInt16LE(18);
    const arch = machine === 0x3e ? 'x64' : machine === 0xb7 ? 'arm64' : machine === 0x28 ? 'arm' : `machine:${machine}`;
    // musl binaries link against libc.musl / ld-musl; glibc ones against libc.so.6
    const text = b.toString('latin1');
    const libc = text.includes('ld-musl') || text.includes('libc.musl') ? 'musl' : 'glibc';
    return { os: 'linux', arch, libc };
  }
  // PE: "MZ", e_lfanew at 0x3c → "PE\0\0" then Machine (u16)
  if (b.toString('latin1', 0, 2) === 'MZ') {
    const pe = b.readUInt32LE(0x3c);
    const machine = b.readUInt16LE(pe + 4);
    return { os: 'win32', arch: machine === 0x8664 ? 'x64' : machine === 0xaa64 ? 'arm64' : `machine:${machine.toString(16)}` };
  }
  return { os: 'unknown', arch: 'unknown' };
}

function check(target, file) {
  if (!existsSync(file)) return `${target}: missing ${file}`;
  const [platform, arch] = target.split('-');
  const os = platform === 'linuxmusl' ? 'linux' : platform;
  const got = inspect(file);
  const want = { os, arch, ...(os === 'linux' ? { libc: platform === 'linuxmusl' ? 'musl' : 'glibc' } : {}) };
  const ok = Object.entries(want).every(([k, v]) => got[k] === v);
  return ok ? null : `${target}: ${file} is ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`;
}

const [, , a, b] = process.argv;
const errors =
  a === '--all'
    ? NATIVE_TARGETS.map((t) => check(t, join(b, binaryName(t)))).filter(Boolean)
    : [check(a, b)].filter(Boolean);
for (const e of errors) console.error('✗ ' + e);
if (errors.length) process.exit(1);
console.log(a === '--all' ? `✓ all ${NATIVE_TARGETS.length} native binaries present and correct` : `✓ ${a}`);
