export function uuid(value) {
  const text = String(value).trim().toLowerCase();
  if (/^(?:0x)?[0-9a-f]{4}$/.test(text)) return '0000' + text.replace(/^0x/, '') + '-0000-1000-8000-00805f9b34fb';
  if (/^(?:0x)?[0-9a-f]{8}$/.test(text)) return text.replace(/^0x/, '') + '-0000-1000-8000-00805f9b34fb';
  if (/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(text)) return text;
  throw new Error('Enter a 4-digit, 8-digit, or full 128-bit service UUID.');
}
export const names = new Map([
  ['180f', 'Battery Service'], ['180a', 'Device Information'],
  ['180d', 'Heart Rate'], ['181a', 'Environmental Sensing'],
  ['2a19', 'Battery Level'], ['2a29', 'Manufacturer Name'],
  ['2a24', 'Model Number'], ['2a37', 'Heart Rate Measurement'], ['2a6e', 'Temperature']
].map(([id, name]) => [uuid(id), name]));
export const serviceName = id => names.get(id) || 'Custom / unrecognized service';

export function requestOptions(filter, custom) {
  const extra = custom.trim() ? custom.split(/[\s,]+/).filter(Boolean).map(uuid) : [];
  const optionalServices = [...new Set(['180f', '180a', '180d', '181a'].map(uuid).concat(extra))];
  if (filter === 'battery') return { filters: [{ services: [uuid('180f')] }], optionalServices };
  return { acceptAllDevices: true, optionalServices };
}
export function explain(error, stage) {
  const detail = error.message || String(error);
  const messages = {
    NotFoundError: stage === 'choose'
      ? 'No device was selected. The picker may have been canceled or no matching device appeared.'
      : 'The requested service or characteristic was not found.',
    SecurityError: 'The browser denied access. Check service permissions and use this page directly over HTTPS.',
    NotAllowedError: 'Bluetooth permission was denied. Check this site’s browser permissions.',
    NotSupportedError: 'This Bluetooth operation is unavailable in this browser or on this device.',
    NetworkError: 'The Bluetooth operation failed. Wake the device, bring it closer, and close other apps using it before retrying.'
  };
  return (messages[error.name] || 'The operation could not finish.') + ' (' + detail + ')';
}

// One device per session. Reset invalidates every pending operation so that late
// results from a previous device can never populate the new device's readout.
export class Analyzer {
  constructor(bluetooth, changed = () => {}) {
    this.bluetooth = bluetooth;
    this.changed = changed;
    this.revision = 0;
    this.device = null;
    this.watchController = null;
    this.listenerController = null;
    this.timer = null;
    this.reset();
  }
  reset() {
    this.revision++;
    this.watchController?.abort();
    this.listenerController?.abort();
    clearTimeout(this.timer);
    this.device?.gatt?.disconnect();
    this.device = null;
    this.watchController = null;
    this.state = {
      name: 'No device selected', connection: 'Idle', busy: false,
      advertised: [], accessible: [], packets: 0, rssi: null, lastSeen: null,
      advertisementStatus: 'Choose a device to listen for advertisements.',
      serviceStatus: 'Connect to inspect permitted primary services.',
      message: 'Set the device filter, then choose a device.', requested: [],
      watching: false, advertisementSupported: false, battery: null
    };
    this.changed(this.state);
  }
  publish(message) {
    if (message) this.state.message = message;
    this.changed(this.state);
  }
  async choose(options) {
    if (this.state.busy) return;
    this.reset();
    const revision = this.revision;
    this.state.busy = true;
    this.publish('Waiting for a device selection…');
    try {
      // Call directly in the click handler's task to retain user activation.
      const device = await this.bluetooth.requestDevice(options);
      if (revision !== this.revision) return;
      this.device = device;
      this.state.name = device.name || 'Unnamed BLE device';
      this.state.requested = options.optionalServices;
      this.state.connection = 'Selected';
      this.state.advertisementSupported = typeof device.watchAdvertisements === 'function';
      this.state.advertisementStatus = this.state.advertisementSupported
        ? 'Ready. Listen before connecting; some devices stop advertising while connected.'
        : 'Advertisement watching is unavailable here. You can still try connecting.';
      this.listenerController = new AbortController();
      device.addEventListener('gattserverdisconnected', () => {
        if (revision !== this.revision) return;
        this.state.connection = 'Disconnected';
        this.state.accessible = [];
        this.state.battery = null;
        this.state.serviceStatus = 'Connection ended. Reconnect to inspect services again.';
        this.publish('Device disconnected. Previously observed advertisements remain in the log.');
      }, { signal: this.listenerController.signal });
      this.publish('Device selected. Listen for advertisements or connect to inspect services.');
    } catch (error) {
      if (revision === this.revision) this.publish(explain(error, 'choose'));
    } finally {
      if (revision === this.revision) {
        this.state.busy = false;
        this.publish();
      }
    }
  }
  stopListening() {
    this.watchController?.abort();
    this.watchController = null;
    clearTimeout(this.timer);
    this.state.watching = false;
    this.state.advertisementStatus = 'Listening stopped. Observations below are retained for this device.';
    this.publish();
  }
  async listen() {
    if (!this.device || !this.state.advertisementSupported || this.state.watching) return;
    const revision = this.revision;
    const controller = new AbortController();
    this.watchController = controller;
    this.state.watching = true;
    this.state.advertisementStatus = 'Waiting for an advertisement from the selected device…';
    this.publish();
    this.device.addEventListener('advertisementreceived', event => {
      if (revision !== this.revision || controller.signal.aborted) return;
      const observed = new Set(this.state.advertised);
      for (const id of event.uuids || []) observed.add(uuid(id));
      this.state.advertised = [...observed];
      this.state.packets++;
      this.state.rssi = Number.isFinite(event.rssi) ? event.rssi : null;
      this.state.lastSeen = new Date().toLocaleTimeString();
      this.state.advertisementStatus = observed.size
        ? 'Service UUIDs observed in advertisements during this session.'
        : 'Advertisement received with no visible service UUIDs. This does not establish which services the device supports.';
      this.publish();
    }, { signal: controller.signal });
    this.timer = setTimeout(() => {
      if (revision !== this.revision || controller.signal.aborted || this.state.packets) return;
      this.state.advertisementStatus = 'No advertisement received yet. The device may be quiet, connected elsewhere, or out of range. Listening continues.';
      this.publish();
    }, 12000);
    try {
      await this.device.watchAdvertisements({ signal: controller.signal });
    } catch (error) {
      if (revision !== this.revision || controller.signal.aborted) return;
      this.stopListening();
      this.state.advertisementStatus = explain(error, 'listen');
      this.publish('Advertisement watching failed. You can still try connecting.');
    }
  }
  async connect() {
    if (!this.device || this.state.busy) return;
    const revision = this.revision;
    const device = this.device;
    this.state.busy = true;
    this.state.battery = null;
    this.state.accessible = [];
    this.state.connection = 'Connecting';
    this.state.serviceStatus = 'Inspecting permitted primary services…';
    this.publish('Connecting to the device’s GATT server…');
    try {
      const server = await device.gatt.connect();
      if (revision !== this.revision) {
        // A reset may have happened before this connection finished.
        if (this.device !== device) server.disconnect();
        return;
      }
      this.state.connection = 'Connected';
      const services = await server.getPrimaryServices();
      if (!server.connected) throw new DOMException("Device disconnected during discovery", "NetworkError");
      for (const service of services) {
        if (revision !== this.revision) return;
        const entry = { uuid: service.uuid, characteristics: [], error: '' };
        try {
          const characteristics = await service.getCharacteristics();
          entry.characteristics = characteristics.map(c => ({
            uuid: c.uuid,
            operations: ['read', 'write', 'writeWithoutResponse', 'notify', 'indicate'].filter(key => c.properties[key])
          }));
        } catch (error) {
          entry.error = explain(error, 'characteristics');
        }
        if (revision !== this.revision) return;
        if (!server.connected) throw new DOMException("Device disconnected during discovery", "NetworkError");
        this.state.accessible.push(entry);
      }
      this.state.serviceStatus = services.length
        ? 'Primary services returned by this connection, within this site’s permissions.'
        : 'No permitted primary services returned. This is not a complete device inventory.';
      this.publish('Service inspection finished. Expand a service to inspect its characteristics.');
    } catch (error) {
      if (revision !== this.revision) return;
      this.state.connection = device.gatt?.connected ? 'Connected' : 'Disconnected';
      this.state.serviceStatus = explain(error, 'connect');
      this.publish('Inspection could not finish. Check the service readout for details.');
    } finally {
      if (revision === this.revision) {
        this.state.busy = false;
        this.publish();
      }
    }
  }
  async readBattery() {
    if (this.state.busy || !this.device?.gatt?.connected) return;
    const revision = this.revision;
    this.state.busy = true;
    this.publish('Reading the battery level…');
    try {
      const service = await this.device.gatt.getPrimaryService(uuid('180f'));
      const characteristic = await service.getCharacteristic(uuid('2a19'));
      const value = await characteristic.readValue();
      if (revision !== this.revision) return;
      if (!this.device.gatt.connected) throw new DOMException("Device disconnected during read", "NetworkError");
      if (value.byteLength < 1 || value.getUint8(0) > 100) throw new Error('Battery value is outside the expected 0–100 range.');
      this.state.battery = value.getUint8(0);
      this.publish('Battery level read successfully.');
    } catch (error) {
      if (revision === this.revision) {
        this.state.battery = null;
        this.publish(explain(error, 'battery'));
      }
    } finally {
      if (revision === this.revision) {
        this.state.busy = false;
        this.publish();
      }
    }
  }
  disconnect() {
    this.device?.gatt?.disconnect();
  }
}
