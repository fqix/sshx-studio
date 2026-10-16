// Several terminals in one session tab: independent shells on one SSH connection.
import * as assert from 'assert';
import type { HostMessage } from '../shared/protocol';
import { TerminalChannel } from '../src/session/terminalChannel';
import { connect } from '../src/ssh/connect';
import type { HostResolver, Prompter } from '../src/ssh/types';

export async function terminalTests(cfg: HostResolver, prompter: Prompter) {
  const conn = await connect(cfg, 'direct', prompter);
  const output = new Map<number, string>();
  const send = (m: HostMessage) => {
    if (m.type === 'term.data') output.set(m.term, (output.get(m.term) ?? '') + m.data);
  };
  const waitFor = async (cond: () => boolean) => {
    const end = Date.now() + 5000;
    while (!cond()) {
      if (Date.now() > end) throw new Error(`timed out; output: ${JSON.stringify([...output])}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  };

  const one = new TerminalChannel(1, send, () => {});
  const two = new TerminalChannel(2, send, () => {});
  await Promise.all([one.open(conn.client), two.open(conn.client)]);
  one.input('hello-one');
  two.input('hello-two');
  await waitFor(() => output.get(1) === 'hello-one' && output.get(2) === 'hello-two');

  // Closing one terminal ends only its shell; the connection and the other shell stay up.
  one.close();
  one.input('ignored');
  const three = new TerminalChannel(3, send, () => {});
  await three.open(conn.client);
  two.input('+more');
  three.input('hello-three');
  await waitFor(() => output.get(2) === 'hello-two+more' && output.get(3) === 'hello-three');
  assert.strictEqual(output.get(1), 'hello-one', 'closed terminal gets nothing more');

  conn.dispose();
  console.log('ok  terminals: several shells on one connection, closing one keeps the others');
}
