import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeValue } from '../docs/values.mjs';
import { Analyzer, uuid, requestOptions } from '../docs/bluetooth.mjs';
import { sampleBluetooth } from '../docs/sample.mjs';
const view = values => new DataView(Uint8Array.from(values).buffer);

test('decoders respect offsets and distinguish strings, battery, PnP, malformed and unknown data', () => {
  const bytes = new TextEncoder().encode('!Acme!');
  assert.equal(decodeValue(uuid('2a29'), new DataView(bytes.buffer, 1, 4)).formatted, 'Acme');
  assert.equal(decodeValue(uuid('2a19'), view([76])).formatted, '76%');
  assert.match(decodeValue(uuid('2a19'), view([255])).formatted, /Invalid/);
  assert.match(decodeValue(uuid('2a50'), view([2, 0x34, 0x12, 0x78, 0x56, 0, 1])).formatted, /Vendor ID: 0x1234/);
  assert.match(decodeValue(uuid('2a50'), view([2])).formatted, /expected 7/);
  assert.match(decodeValue(uuid('2a29'), view([255])).formatted, /Invalid UTF-8/);
  assert.equal(decodeValue(uuid('ffff'), view([0, 255])).hex, '00 ff');
  assert.match(decodeValue(uuid('ffff'), view([])).formatted, /Empty/);
});

async function connected() {
  const analyzer = new Analyzer(sampleBluetooth());
  await analyzer.choose(requestOptions('all', ''));
  await analyzer.connect();
  const characteristic = analyzer.state.accessible[1].characteristics[0];
  return { analyzer, key: characteristic.key };
}
test('reads values, reports permission errors, and allows retry', async () => {
  const { analyzer, key } = await connected();
  await analyzer.readCharacteristic(key);
  assert.equal(analyzer.state.readings[key].formatted, 'Sample Instruments');
  const handle = analyzer.readHandles.get(key);
  const read = handle.readValue;
  handle.readValue = async () => { throw new DOMException('Access denied', 'NotAllowedError'); };
  await analyzer.readCharacteristic(key);
  assert.equal(analyzer.state.readings[key].error, true);
  handle.readValue = read;
  await analyzer.readCharacteristic(key);
  assert.equal(analyzer.state.readings[key].formatted, 'Sample Instruments');
  analyzer.reset();
});
test('reset and disconnect discard late reads, and concurrent reads are ignored', async () => {
  for (const action of ['reset', 'disconnect']) {
    const { analyzer, key } = await connected();
    let resolve;
    let calls = 0;
    analyzer.readHandles.get(key).readValue = () => { calls++; return new Promise(done => { resolve = done; }); };
    const reading = analyzer.readCharacteristic(key);
    await analyzer.readCharacteristic(key);
    assert.equal(calls, 1);
    analyzer[action]();
    resolve(view([65]));
    await reading;
    assert.deepEqual(analyzer.state.readings, {});
    assert.equal(analyzer.state.busy, false);
    analyzer.reset();
  }
});
