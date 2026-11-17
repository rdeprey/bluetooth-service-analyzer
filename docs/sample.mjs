import { uuid } from './bluetooth.mjs';

// Deliberately deterministic. All sample values are labeled in the interface.
export function sampleBluetooth() {
  return {
    async requestDevice(options) {
      const device = new EventTarget();
      device.name = 'Bench sensor · sample';
      const permissions = new Set(options.optionalServices);
      const definitions = [
        ['180f', [['2a19', { read: true, notify: true }]]],
        ['180a', [['2a29', { read: true }], ['2a26', { read: true }], ['2a50', { read: true }]]]
      ];
      const services = definitions.map(([id, characteristics]) => ({
        uuid: uuid(id),
        async getCharacteristics() {
          return characteristics.map(([id, properties]) => ({
            uuid: uuid(id), properties,
            async readValue() {
              const bytes = id === '2a19' ? Uint8Array.of(76)
                : id === '2a50' ? Uint8Array.of(2, 0x34, 0x12, 0x78, 0x56, 0, 1)
                : new TextEncoder().encode(id === '2a26' ? '1.2.3 (sample)' : 'Sample Instruments');
              return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            }
          }));
        },
        async getCharacteristic(id) {
          const result = (await this.getCharacteristics()).find(c => c.uuid === id);
          if (!result) throw new DOMException('Characteristic not found', 'NotFoundError');
          return result;
        }
      })).filter(service => permissions.has(service.uuid));
      device.gatt = {
        connected: false,
        async connect() { this.connected = true; return this; },
        disconnect() {
          if (!this.connected) return;
          this.connected = false;
          device.dispatchEvent(new Event('gattserverdisconnected'));
        },
        async getPrimaryServices() { return services; },
        async getPrimaryService(id) {
          const result = services.find(s => s.uuid === id);
          if (!result) throw new DOMException('Service not found', 'NotFoundError');
          return result;
        }
      };
      device.watchAdvertisements = async ({ signal }) => {
        const send = () => {
          if (signal.aborted) return;
          const event = new Event('advertisementreceived');
          Object.assign(event, { uuids: permissions.has(uuid('180f')) ? [uuid('180f')] : [] });
          device.dispatchEvent(event);
        };
        send();
        const timer = setInterval(send, 2000);
        signal.addEventListener('abort', () => clearInterval(timer), { once: true });
      };
      return device;
    }
  };
}
