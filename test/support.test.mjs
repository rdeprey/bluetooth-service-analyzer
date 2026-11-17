import test from 'node:test';
import assert from 'node:assert/strict';
import { browserSupport, canReadBattery } from '../docs/support.mjs';
import { Analyzer, requestOptions, uuid } from '../docs/bluetooth.mjs';
import { sampleBluetooth } from '../docs/sample.mjs';

test('support distinguishes missing APIs, page restrictions, unavailable adapters, and runtime blocks', () => {
  const capable = { secure: true, bluetooth: { requestDevice() {} } };
  assert.equal(browserSupport(capable).warning, false);
  for (const change of [{ secure: false }, { bluetooth: undefined }, { policyAllowed: false }, { blocked: true }]) {
    assert.equal(browserSupport({ ...capable, ...change }).canChoose, false);
  }
  const unavailable = browserSupport({ ...capable, available: false });
  assert.equal(unavailable.warning, true);
  assert.equal(unavailable.canChoose, true);
});

test('Brave global disable is not reported as a canceled picker', async () => {
  const analyzer = new Analyzer({ requestDevice: async () => { throw new DOMException('Web Bluetooth API globally disabled.', 'NotFoundError'); } });
  await analyzer.choose(requestOptions('all', ''));
  assert.equal(analyzer.state.bluetoothBlocked, true);
  analyzer.reset();
  assert.equal(analyzer.state.bluetoothBlocked, false);
});

test('battery controls require a connected readable Battery Level, not merely Battery Service', async () => {
  const analyzer = new Analyzer(sampleBluetooth());
  assert.equal(canReadBattery(analyzer.state, uuid), false);
  await analyzer.choose(requestOptions('all', ''));
  await analyzer.connect();
  assert.equal(canReadBattery(analyzer.state, uuid), true);
  const battery = analyzer.state.accessible.find(s => s.uuid === uuid('180f'));
  battery.characteristics[0].operations = ['notify'];
  assert.equal(canReadBattery(analyzer.state, uuid), false);
  battery.characteristics = [];
  assert.equal(canReadBattery(analyzer.state, uuid), false);
  analyzer.reset();
  assert.equal(canReadBattery(analyzer.state, uuid), false);
});
