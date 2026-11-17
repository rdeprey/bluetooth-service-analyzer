import { decodeValue } from './values.mjs';
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
  ['2a24', 'Model Number'], ['2a23', 'System ID'], ['2a25', 'Serial Number'],
  ['2a26', 'Firmware Revision'], ['2a27', 'Hardware Revision'], ['2a28', 'Software Revision'],
  ['2a50', 'PnP ID'], ['2a37', 'Heart Rate Measurement'], ['2a6e', 'Temperature']
].map(([id, name]) => [uuid(id), name]));
export const serviceName = id => names.get(id) || 'Custom / unrecognized service';

// Standard meanings: Bluetooth SIG Device Information Service and Assigned Numbers.
// https://www.bluetooth.com/wp-content/uploads/Files/Specification/HTML/DIS_v1.2/out/en/index-en.html
export const characteristicDescriptions = new Map([
  ['2a23', 'An identifier combining a manufacturer identifier and an organizationally unique identifier.'],
  ['2a24', 'The manufacturer’s model number for this device.'],
  ['2a25', 'The manufacturer’s serial number for this individual device.'],
  ['2a26', 'The version of the firmware running on the device.'],
  ['2a27', 'The revision of the device’s physical hardware.'],
  ['2a28', 'The version of the software within the device.'],
  ['2a29', 'The name of the device’s manufacturer.'],
  ['2a50', 'Vendor ID source, vendor ID, product ID, and product version used to identify the product. This is structured data, not a text name.'],
  ['2a19', 'The battery charge level, expressed as a percentage from 0 to 100.'],
  ['2a37', 'Heart-rate measurements, with optional sensor-contact, energy, and beat-interval information.'],
  ['2a6e', 'A temperature measurement in degrees Celsius.']
].map(([id, description]) => [uuid(id), description]));
export function characteristicDescription(id) {
  return characteristicDescriptions.get(id) || 'This UUID is not in the demo’s reference table. It may be a standard characteristic not listed here or a manufacturer-specific one; its meaning requires the relevant specification or device documentation.';
}
export function describeOperations(operations) {
  const descriptions = {
    read: 'Read: request its current value',
    write: 'Write: send a value with a response',
    writeWithoutResponse: 'Write without response: send a value without a response',
    notify: 'Notify: subscribe to updates without confirming each one',
    indicate: 'Indicate: subscribe to updates confirmed by the client'
  };
  return operations.map(operation => descriptions[operation] || operation).join(' · ') || 'No supported operations reported.';
}

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
    this.readHandles = new Map();
    this.watchController = null;
    this.state = {
      name: 'No device selected', connection: 'Idle', busy: false,
      advertised: [], accessible: [], packets: 0, rssi: null, lastSeen: null,
      advertisementStatus: 'Choose a device to listen for advertisements.',
      serviceStatus: 'Connect to inspect permitted primary services.',
      message: 'Set the device filter, then choose a device.', requested: [],
      watching: false, advertisementSupported: false, battery: null, bluetoothBlocked: false, readings: {}, readingKey: null
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
        this.readHandles.clear();
        this.state.readings = {};
        this.state.battery = null;
        this.state.serviceStatus = 'Connection ended. Reconnect to inspect services again.';
        this.publish('Device disconnected. Previously observed advertisements remain in the log.');
      }, { signal: this.listenerController.signal });
      this.publish('Device selected. Listen for advertisements or connect to inspect services.');
    } catch (error) {
      if (revision === this.revision) {
        this.state.bluetoothBlocked = /bluetooth.*globally disabled/i.test(error.message || '');
        this.publish(this.state.bluetoothBlocked
          ? 'Web Bluetooth is disabled in this browser. See the browser support notice above.'
          : explain(error, 'choose'));
      }
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
    this.readHandles.clear();
    this.state.readings = {};
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
      let services;
      try {
        services = await server.getPrimaryServices();
      } catch (error) {
        if (error.name !== 'NotFoundError') throw error;
        services = [];
      }
      if (!server.connected) throw new DOMException("Device disconnected during discovery", "NetworkError");
      for (const service of services) {
        if (revision !== this.revision) return;
        const entry = { uuid: service.uuid, characteristics: [], error: '' };
        try {
          const characteristics = await service.getCharacteristics();
          entry.characteristics = characteristics.map((c, index) => {
            const key = `${this.state.accessible.length}:${index}`;
            this.readHandles.set(key, c);
            return {
              key, uuid: c.uuid,
              operations: ['read', 'write', 'writeWithoutResponse', 'notify', 'indicate'].filter(key => c.properties[key])
            };
          });
        } catch (error) {
          entry.error = explain(error, 'characteristics');
        }
        if (revision !== this.revision) return;
        if (!server.connected) throw new DOMException("Device disconnected during discovery", "NetworkError");
        this.state.accessible.push(entry);
      }
      this.state.serviceStatus = services.length
        ? 'Primary services returned by this connection, within this site’s permissions.'
        : 'Connected, but no services are accessible with this site’s current permissions. The device may use other service UUIDs. If its documentation lists them, add them under Service permissions, choose the device again, then reconnect. This result does not prove the device has no services.';
      this.publish(services.length
        ? 'Service inspection finished. Expand a service to inspect its characteristics.'
        : 'Connected, but no accessible services were found. See the guidance below.');
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
  async readCharacteristic(key) {
    const characteristic = this.readHandles.get(key);
    if (this.state.busy || !this.device?.gatt?.connected || !characteristic?.properties.read) return;
    const revision = this.revision;
    const current = () => revision === this.revision && this.readHandles.get(key) === characteristic;
    this.state.busy = true;
    this.state.readingKey = key;
    this.state.readings[key] = { formatted: 'Reading…', hex: '' };
    this.publish('Reading characteristic…');
    try {
      const value = await characteristic.readValue();
      if (!current() || !this.device?.gatt?.connected) return;
      this.state.readings[key] = decodeValue(characteristic.uuid, value);
      if (characteristic.uuid === uuid('2a19') && value.byteLength === 1 && value.getUint8(0) <= 100) this.state.battery = value.getUint8(0);
      this.publish('Characteristic value read. Results stay in this tab.');
    } catch (error) {
      if (!current()) return;
      this.state.readings[key] = { formatted: explain(error, 'read'), hex: '', error: true };
      this.publish('Read failed. See the characteristic for details; you can retry.');
    } finally {
      if (revision === this.revision) {
        this.state.busy = false;
        this.state.readingKey = null;
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
