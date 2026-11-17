import test from 'node:test';
import assert from 'node:assert/strict';
import { Analyzer, requestOptions, uuid } from '../docs/bluetooth.mjs';
import { sampleBluetooth } from '../docs/sample.mjs';

test('filters retain the requested service permissions and normalize custom UUIDs', () => {
  const options = requestOptions('battery', '180F, 12345678-1234-5678-1234-56789abcdef0');
  assert.deepEqual(options.filters, [{ services: [uuid('180f')] }]);
  assert.equal(options.optionalServices.length, 5);
  assert.equal(requestOptions('all', '').acceptAllDevices, true);
  assert.throws(() => requestOptions('all', 'bad-uuid'));
});

test('advertisements, accessible services, and battery remain distinct', async () => {
  const analyzer = new Analyzer(sampleBluetooth());
  try {
    await analyzer.choose(requestOptions('all', ''));
    await analyzer.listen();
    assert.deepEqual(analyzer.state.advertised, [uuid('180f')]);
    assert.equal(analyzer.state.accessible.length, 0);
    await analyzer.connect();
    assert.deepEqual(analyzer.state.accessible.map(s => s.uuid), [uuid('180f'), uuid('180a')]);
    await analyzer.readBattery();
    assert.equal(analyzer.state.battery, 76);
    analyzer.disconnect();
    assert.equal(analyzer.state.connection, 'Disconnected');
    assert.equal(analyzer.state.battery, null);
    assert.equal(analyzer.state.accessible.length, 0);
    assert.equal(analyzer.state.advertised.length, 1);
    await analyzer.connect();
    assert.equal(analyzer.state.accessible.length, 2);
    analyzer.stopListening();
    assert.equal(analyzer.state.watching, false);
  } finally { analyzer.reset(); }
});

test('canceling a picker and missing advertisement support remain distinguishable', async () => {
  const analyzer = new Analyzer({
    async requestDevice() { throw new DOMException('User cancelled', 'NotFoundError'); }
  });
  await analyzer.choose(requestOptions('all', ''));
  assert.match(analyzer.state.message, /No device was selected/);
  assert.equal(analyzer.state.busy, false);
  const bluetooth = sampleBluetooth();
  analyzer.bluetooth = { async requestDevice(options) {
    const device = await bluetooth.requestDevice(options);
    delete device.watchAdvertisements;
    return device;
  } };
  await analyzer.choose(requestOptions('all', ''));
  assert.equal(analyzer.state.advertisementSupported, false);
  await analyzer.connect();
  assert.equal(analyzer.state.connection, 'Connected');
  analyzer.reset();
});

test('reset discards late chooser and connection results', async () => {
  const choose = Promise.withResolvers();
  const analyzer = new Analyzer({ requestDevice: () => choose.promise });
  const pending = analyzer.choose(requestOptions('all', ''));
  analyzer.reset();
  choose.resolve(await sampleBluetooth().requestDevice(requestOptions('all', '')));
  await pending;
  assert.equal(analyzer.device, null);
  analyzer.bluetooth = sampleBluetooth();
  await analyzer.choose(requestOptions('all', ''));
  const device = analyzer.device;
  const connect = Promise.withResolvers();
  device.gatt.connect = () => connect.promise;
  const connecting = analyzer.connect();
  analyzer.reset();
  device.gatt.connected = true;
  connect.resolve(device.gatt);
  await connecting;
  assert.equal(device.gatt.connected, false);
  assert.equal(analyzer.state.accessible.length, 0);
  assert.equal(analyzer.state.connection, 'Idle');
});

test('a failed advertisement request cleans up and permits retry', async () => {
  const adapter = sampleBluetooth();
  const analyzer = new Analyzer(adapter);
  await analyzer.choose(requestOptions('all', ''));
  const watch = analyzer.device.watchAdvertisements;
  analyzer.device.watchAdvertisements = async () => { throw new DOMException('Unavailable', 'NotSupportedError'); };
  await analyzer.listen();
  assert.equal(analyzer.state.watching, false);
  assert.match(analyzer.state.advertisementStatus, /unavailable/);
  analyzer.device.watchAdvertisements = watch;
  await analyzer.listen();
  assert.equal(analyzer.state.packets, 1);
  analyzer.reset();
});

test('an empty advertisement means a packet arrived, without visible service UUIDs', async () => {
  const analyzer = new Analyzer(sampleBluetooth());
  await analyzer.choose({ acceptAllDevices: true, optionalServices: [] });
  await analyzer.listen();
  assert.equal(analyzer.state.packets, 1);
  assert.deepEqual(analyzer.state.advertised, []);
  assert.match(analyzer.state.advertisementStatus, /no visible service UUIDs/);
  await analyzer.connect();
  assert.equal(analyzer.state.connection, 'Connected');
  assert.deepEqual(analyzer.state.accessible, []);
  analyzer.reset();
});

test('no permitted services leaves a successful connection with actionable guidance', async () => {
  const bluetooth = sampleBluetooth();
  const device = await bluetooth.requestDevice(requestOptions('all', ''));
  device.gatt.getPrimaryServices = async () => { throw new DOMException('No Services found in device.', 'NotFoundError'); };
  const analyzer = new Analyzer({ requestDevice: async () => device });
  await analyzer.choose(requestOptions('all', ''));
  await analyzer.connect();
  assert.equal(analyzer.state.connection, 'Connected');
  assert.deepEqual(analyzer.state.accessible, []);
  assert.match(analyzer.state.serviceStatus, /current permissions/);
  assert.match(analyzer.state.message, /no accessible services/);
  analyzer.reset();
});
